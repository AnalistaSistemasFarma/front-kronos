'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Collapse, Group, Loader, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconEye, IconGripVertical, IconHierarchy2, IconSearch } from '@tabler/icons-react';
import SgcSelect from '../SgcSelect';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';
import SgcParentLinkModal, { type SgcParentLinkTarget } from './SgcParentLinkModal';
import { SgcStatusBadge } from '../SgcBadges';
import { sgcHref } from '../useSgcCompany';
import { useSgcFetch } from '../useSgcFetch';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcRelationGraph } from '../../../lib/sgc/db/relations';
import { buildDocumentTree, filterTree, type SgcTreeDoc, type SgcTreeNode } from '../../../lib/sgc/hierarchy';
import { SGC_RELATION_LABELS, SGC_RELATION_STYLES } from '../../../lib/sgc/relations';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';

/**
 * ÁRBOL DOCUMENTAL para el auditor (documentos padre e hijos, 2026-10-19):
 * cada procedimiento y, debajo, todo lo que se desprende de él (formatos,
 * instructivos, anexos), en una lista jerárquica plegable con estado y versión
 * vigente. «Ver» abre el documento en el VISOR SEGURO dentro de la app, sin
 * descarga ni impresión (RN «ver documento sin descarga»). Solo muestra lo que
 * la persona puede consultar (lo decide el servidor, como el mapa).
 *
 * Calidad además relaciona los documentos sin padre: arrastrándolos sobre el
 * procedimiento (escritorio) o con el botón «Relacionar con padre» (teclado y
 * celular). La confirmación, el motivo y las reglas son las mismas del mapa.
 */

type Doc = SgcTreeDoc & { title: string; process: string; idProcess: number; documentTypeCode: string };

function DocRow({
  doc,
  relationLabel,
  relationColor,
  idCompany,
  onView,
  extra,
}: {
  doc: Doc;
  relationLabel?: string | null;
  relationColor?: string;
  idCompany: number;
  onView: (d: Doc) => void;
  extra?: React.ReactNode;
}) {
  return (
    <Group gap='xs' wrap='wrap' justify='space-between' style={{ rowGap: 4 }} data-testid='sgc-arbol-documento' data-code={doc.code}>
      <Group gap={6} wrap='wrap' style={{ minWidth: 0, flex: '1 1 260px' }}>
        {relationLabel && (
          <Badge size='xs' variant='light' color={relationColor} style={{ flexShrink: 0 }}>
            {relationLabel}
          </Badge>
        )}
        <Anchor component={Link} href={sgcHref(`${SGC_BASE_URL}/documentos/${doc.id}`, idCompany)} ff='monospace' fw={700} size='sm'>
          {doc.code}
        </Anchor>
        <Badge variant='filled' color='dark' size='xs' radius='sm' style={{ flexShrink: 0 }}>
          {doc.versionNumber ? `V${doc.versionNumber}` : 'sin versión'}
        </Badge>
        <SgcStatusBadge status={doc.status} />
        <Text size='sm' style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {doc.title}
        </Text>
      </Group>
      <Group gap={4} wrap='nowrap'>
        {extra}
        <Button size='xs' variant='subtle' leftSection={<IconEye size={14} />} disabled={!doc.currentVersionId} onClick={() => onView(doc)} data-testid='sgc-arbol-ver'>
          Ver
        </Button>
      </Group>
    </Group>
  );
}

function Branch({ node, depth, idCompany, onView, open, toggle }: { node: SgcTreeNode<Doc>; depth: number; idCompany: number; onView: (d: Doc) => void; open: Set<number>; toggle: (id: number) => void }) {
  const isOpen = open.has(node.doc.id);
  return (
    <div style={{ marginLeft: depth ? 14 : 0, paddingLeft: depth ? 12 : 0, borderLeft: depth ? '2px solid var(--mantine-color-default-border)' : undefined }}>
      <Group gap={4} wrap='nowrap' align='flex-start' py={4}>
        {node.children.length > 0 ? (
          <ActionIcon variant='subtle' color='gray' size='sm' onClick={() => toggle(node.doc.id)} aria-label={isOpen ? `Contraer ${node.doc.code}` : `Expandir ${node.doc.code}`} aria-expanded={isOpen} mt={2}>
            {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
        ) : (
          <span style={{ width: 22, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <DocRow doc={node.doc} idCompany={idCompany} onView={onView} relationLabel={node.relationType ? SGC_RELATION_LABELS[node.relationType] : null} relationColor={node.relationType ? SGC_RELATION_STYLES[node.relationType].mantine : undefined} />
        </div>
      </Group>
      <Collapse in={isOpen}>
        {node.children.map((c) => (
          <Branch key={c.doc.id} node={c} depth={depth + 1} idCompany={idCompany} onView={onView} open={open} toggle={toggle} />
        ))}
      </Collapse>
    </div>
  );
}

export default function SgcDocumentTree({ company, focusDocument }: { company: SgcCompanyAccess; focusDocument?: number | null }) {
  const [showObsolete, setShowObsolete] = useState(false);
  const graph = useSgcFetch<SgcRelationGraph>(`/api/sgc/relations?company=${company.idCompany}${showObsolete ? '&obsoletos=1' : ''}`);
  const [query, setQuery] = useState('');
  const [process, setProcess] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [link, setLink] = useState<{ child: SgcParentLinkTarget; parent: SgcParentLinkTarget | null; via: 'arrastre' | 'boton' } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const docs: Doc[] = useMemo(
    () =>
      (graph.data?.nodes ?? []).map((n) => ({ id: n.id, code: n.code, title: n.title, status: n.status, documentTypeCode: n.documentTypeCode, versionNumber: n.versionNumber, currentVersionId: n.currentVersionId ?? null, process: n.process, idProcess: n.idProcess })),
    [graph.data]
  );
  const tree = useMemo(() => buildDocumentTree(docs.filter((d) => !process || d.idProcess === Number(process)), graph.data?.edges ?? [], graph.data?.parentTypeCodes ?? []), [docs, graph.data, process]);
  const roots = useMemo(() => filterTree(tree.roots, query), [tree.roots, query]);
  const orphans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tree.orphans.filter((d) => d.code.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)) : tree.orphans;
  }, [tree.orphans, query]);

  // Llega con ?documento=<id> (desde la ficha): abre la rama donde está.
  useEffect(() => {
    if (!focusDocument || !graph.data) return;
    const path = new Set<number>();
    const walk = (n: SgcTreeNode<Doc>, trail: number[]): boolean => {
      if (n.doc.id === focusDocument) {
        trail.forEach((t) => path.add(t));
        path.add(n.doc.id);
        return true;
      }
      return n.children.some((c) => walk(c, [...trail, n.doc.id]));
    };
    tree.roots.some((r) => walk(r, []));
    if (path.size) setOpen((prev) => new Set([...prev, ...path]));
  }, [focusDocument, graph.data, tree.roots]);

  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allIds = (nodes: SgcTreeNode<Doc>[]): number[] => nodes.flatMap((n) => [n.doc.id, ...allIds(n.children)]);
  const processes = [...new Map(docs.map((d) => [d.idProcess, d.process])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));

  // Arrastre (escritorio): un documento sin padre sobre la tarjeta de un procedimiento.
  const onDragStart = (e: DragEvent, d: Doc) => {
    e.dataTransfer.setData('text/plain', String(d.id));
    e.dataTransfer.effectAllowed = 'link';
  };
  const onDrop = (e: DragEvent, parent: Doc) => {
    e.preventDefault();
    setDragOver(null);
    const child = docs.find((d) => String(d.id) === e.dataTransfer.getData('text/plain'));
    if (child && child.id !== parent.id) setLink({ child: { idDocument: child.id, code: child.code, title: child.title }, parent: { idDocument: parent.id, code: parent.code, title: parent.title }, via: 'arrastre' });
  };

  if (graph.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {graph.error}
      </Alert>
    );
  }
  if (!graph.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap='sm' data-testid='sgc-arbol'>
      <Card withBorder radius='md' p='sm'>
        <Group gap='sm' align='flex-end' wrap='wrap'>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Buscar por código o nombre' placeholder='OLP-GGC-01' value={query} onChange={(e) => setQuery(e.currentTarget.value)} leftSection={<IconSearch size={14} />} w={{ base: '100%', sm: 260 }} data-testid='sgc-arbol-buscar' />
          <SgcSelect label='Proceso (área)' data={processes.map(([v, l]) => ({ value: String(v), label: l }))} value={process} onChange={setProcess} clearable searchable w={{ base: '100%', sm: 240 }} />
          <Group gap='xs'>
            <Button variant='default' size='sm' onClick={() => setOpen(new Set(allIds(tree.roots)))} data-testid='sgc-arbol-expandir'>
              Expandir todo
            </Button>
            <Button variant='default' size='sm' onClick={() => setOpen(new Set())}>
              Contraer todo
            </Button>
            {company.canQuality && (
              <Button variant={showObsolete ? 'light' : 'default'} size='sm' onClick={() => setShowObsolete((v) => !v)}>
                {showObsolete ? 'Ocultar obsoletos' : 'Incluir obsoletos'}
              </Button>
            )}
          </Group>
        </Group>
        <Text size='xs' c='dimmed' mt='xs' data-testid='sgc-arbol-conteo'>
          {tree.roots.length} documento(s) padre · {tree.roots.reduce((n, r) => n + r.descendants, 0)} documento(s) que se desprenden · {tree.orphans.length} sin padre. Tipos padre: {(graph.data.parentTypeCodes ?? []).join(', ') || 'ninguno configurado'}.
        </Text>
      </Card>

      {message && (
        <Alert color='green' withCloseButton onClose={() => setMessage(null)} data-testid='sgc-arbol-mensaje'>
          {message}
        </Alert>
      )}
      {tree.multipleParents.length > 0 && company.canQuality && (
        <Alert color='orange' icon={<IconAlertTriangle size={16} />} title='Documentos con más de un padre' data-testid='sgc-arbol-varios-padres'>
          Un hijo tiene un solo padre. Estos documentos quedaron con más de uno antes de la regla: retire en su ficha la relación que sobra.
          <Stack gap={2} mt={4}>
            {tree.multipleParents.map((m) => (
              <Text key={m.doc.id} size='sm'>
                <Anchor component={Link} href={sgcHref(`${SGC_BASE_URL}/documentos/${m.doc.id}`, company.idCompany)} ff='monospace' fw={700}>
                  {m.doc.code}
                </Anchor>{' '}
                → {m.parents.map((p) => p.code).join(', ')}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {roots.length === 0 ? (
        <Alert color='blue' data-testid='sgc-arbol-vacio'>
          {query ? 'Sin coincidencias.' : 'No hay documentos padre que usted pueda consultar.'}
        </Alert>
      ) : (
        roots.map((r) => (
          <Card
            key={r.doc.id}
            withBorder
            radius='md'
            p='sm'
            shadow='xs'
            data-testid='sgc-arbol-padre'
            data-code={r.doc.code}
            style={dragOver === r.doc.id ? { outline: '2px dashed var(--mantine-color-green-6)', outlineOffset: 2 } : undefined}
            onDragOver={company.canQuality ? (e) => { e.preventDefault(); if (dragOver !== r.doc.id) setDragOver(r.doc.id); } : undefined}
            onDragLeave={company.canQuality ? () => setDragOver(null) : undefined}
            onDrop={company.canQuality ? (e) => onDrop(e, r.doc) : undefined}
          >
            <Branch node={r} depth={0} idCompany={company.idCompany} onView={setViewing} open={open} toggle={toggle} />
            <Text size='xs' c='dimmed' ml={26}>
              {r.descendants ? `${r.descendants} documento(s) se desprenden de este procedimiento.` : 'Aún no tiene documentos relacionados.'}
            </Text>
          </Card>
        ))
      )}

      {company.canQuality && orphans.length > 0 && (
        <Card withBorder radius='md' p='sm' data-testid='sgc-arbol-sin-padre'>
          <Text fw={600} size='sm'>
            Documentos sin padre ({orphans.length})
          </Text>
          <Text size='xs' c='dimmed' mb='xs'>
            Formatos, instructivos y demás que aún no cuelgan de un procedimiento. Arrástrelos sobre su procedimiento o use «Relacionar con padre».
          </Text>
          <Stack gap={6}>
            {orphans.map((d) => (
              <div key={d.id} draggable onDragStart={(e) => onDragStart(e, d)} style={{ cursor: 'grab' }} data-testid='sgc-arbol-huerfano' data-code={d.code}>
                <DocRow
                  doc={d}
                  idCompany={company.idCompany}
                  onView={setViewing}
                  extra={
                    <>
                      <Tooltip label='Arrastre sobre el procedimiento'>
                        <IconGripVertical size={16} color='var(--mantine-color-dimmed)' aria-hidden />
                      </Tooltip>
                      <Button size='xs' variant='light' leftSection={<IconHierarchy2 size={14} />} onClick={() => setLink({ child: { idDocument: d.id, code: d.code, title: d.title }, parent: null, via: 'boton' })} data-testid='sgc-arbol-relacionar'>
                        Relacionar con padre
                      </Button>
                    </>
                  }
                />
              </div>
            ))}
          </Stack>
        </Card>
      )}

      <SgcDocumentViewerModal fileUrl={viewing?.currentVersionId ? `/api/sgc/documents/${viewing.id}/versions/${viewing.currentVersionId}/file` : null} title={viewing ? `${viewing.code} · V${viewing.versionNumber ?? ''} · ${viewing.title}` : ''} onClose={() => setViewing(null)} />
      <SgcParentLinkModal
        child={link?.child ?? null}
        presetParent={link?.parent ?? null}
        via={link?.via ?? 'boton'}
        onClose={() => setLink(null)}
        onDone={(m) => {
          setLink(null);
          setMessage(m);
          graph.reload();
        }}
      />
    </Stack>
  );
}
