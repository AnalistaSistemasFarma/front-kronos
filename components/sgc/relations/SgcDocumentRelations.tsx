'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Group, Modal, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconHierarchy2, IconLink, IconPlus } from '@tabler/icons-react';
import SgcParentLinkModal from './SgcParentLinkModal';
import { sgcHref } from '../useSgcCompany';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { useSgcRowLink } from '../useSgcRowLink';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcDocumentRelationItem, SgcParentOptions } from '../../../lib/sgc/db/relations';
import { SGC_RELATION_LABELS, SGC_RELATION_PHRASES, SGC_RELATION_STYLES, SGC_RELATION_TYPES } from '../../../lib/sgc/relations';

/**
 * Documentos relacionados en la FICHA (Sprint 5): solo los que la persona
 * puede consultar. Calidad registra y retira relaciones (con motivo).
 */
export default function SgcDocumentRelations({ idDocument, idCompany, code, canAdminister }: { idDocument: number; idCompany: number; code: string; canAdminister: boolean }) {
  const rel = useSgcFetch<{ relations: SgcDocumentRelationItem[] }>(`/api/sgc/documents/${idDocument}/relations`);
  // 2026-10-19 (documentos padre e hijos): Calidad ve si el documento es padre, si ya tiene padre o si se puede relacionar.
  const parentInfo = useSgcFetch<SgcParentOptions>(canAdminister ? `/api/sgc/relations/parent?document=${idDocument}` : null);
  const [linking, setLinking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const rowLink = useSgcRowLink();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SgcDocumentRelationItem | null>(null);
  const [type, setType] = useState<string | null>('formato');
  const [direction, setDirection] = useState<string | null>('entra');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setRemoving(null);
      setReason('');
      setOther('');
      setNote('');
      rel.reload();
      parentInfo.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const items = rel.data?.relations ?? [];
  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-relaciones'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconLink size={18} /> Documentos relacionados
        </Title>
        <Group gap='xs'>
          <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/relaciones`, idCompany)} size='xs' variant='default'>
            Ver en el mapa
          </Button>
          <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/arbol`, idCompany, { documento: String(idDocument) })} size='xs' variant='default' data-testid='sgc-relaciones-ver-arbol'>
            Ver en el árbol
          </Button>
          {canAdminister && parentInfo.data && !parentInfo.data.isParentType && !parentInfo.data.parent && (
            <Button size='xs' variant='light' leftSection={<IconHierarchy2 size={14} />} onClick={() => { setDone(null); setLinking(true); }} data-testid='sgc-relacion-con-padre'>
              Relacionar con padre
            </Button>
          )}
          {canAdminister && (
            <Button size='xs' leftSection={<IconPlus size={14} />} onClick={() => { setError(null); setAdding(true); }} data-testid='sgc-relacion-agregar'>
              Relacionar
            </Button>
          )}
        </Group>
      </Group>
      {done && (
        <Alert color='green' mb='sm' withCloseButton onClose={() => setDone(null)} data-testid='sgc-relacion-padre-ok'>
          {done}
        </Alert>
      )}
      {canAdminister && parentInfo.data?.isParentType && (
        <Text size='xs' c='dimmed' mb='xs' data-testid='sgc-relaciones-es-padre'>
          Documento padre (tipo {parentInfo.data.document.documentTypeCode}): no tiene padre. Sus formatos e instructivos se relacionan con él.
        </Text>
      )}
      {items.length === 0 ? (
        <Text size='sm' c='dimmed' data-testid='sgc-relaciones-vacio'>
          Sin documentos relacionados que usted pueda consultar.
        </Text>
      ) : (
        <Table verticalSpacing='xs'>
          <Table.Tbody>
            {items.map((r) => (
              <Table.Tr key={r.id} data-testid='sgc-relacion-fila' data-code={r.other.code} data-type={r.type} {...rowLink(sgcHref(`${SGC_BASE_URL}/documentos/${r.other.idDocument}`, idCompany))}>
                <Table.Td w={170}>
                  <Badge color={SGC_RELATION_STYLES[r.type].mantine} variant='light' size='sm'>
                    {r.typeLabel}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>
                    {r.direction === 'sale' ? `${code} ${SGC_RELATION_PHRASES[r.type].out}` : `${code} ${SGC_RELATION_PHRASES[r.type].in}`}{' '}
                    <Link href={sgcHref(`${SGC_BASE_URL}/documentos/${r.other.idDocument}`, idCompany)}>
                      <Text span ff='monospace' fw={700}>
                        {r.other.code}
                      </Text>
                    </Link>{' '}
                    · {r.other.title}
                  </Text>
                  {r.note && (
                    <Text size='xs' c='dimmed'>
                      {r.note}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td w={90}>
                  {canAdminister && (
                    <Button size='xs' variant='subtle' color='red' onClick={() => { setError(null); setRemoving(r); }}>
                      Retirar
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={adding} onClose={() => setAdding(false)} title={`Relacionar ${code}`} centered>
        <Stack>
          {error && <Alert color='red'>{error}</Alert>}
          <SgcSelect label='Tipo de relación' data={SGC_RELATION_TYPES.map((t) => ({ value: t, label: SGC_RELATION_LABELS[t] }))} value={type} onChange={setType} allowDeselect={false} data-testid='sgc-relacion-tipo' />
          <SgcSelect
            label='Sentido'
            data={[
              { value: 'entra', label: `El otro documento es ${type ? SGC_RELATION_LABELS[type as keyof typeof SGC_RELATION_LABELS].toLowerCase() : '…'} de ${code}` },
              { value: 'sale', label: `${code} es ${type ? SGC_RELATION_LABELS[type as keyof typeof SGC_RELATION_LABELS].toLowerCase() : '…'} del otro documento` },
            ]}
            value={direction}
            onChange={setDirection}
            allowDeselect={false}
          />
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Código del otro documento' placeholder='OLP-GC-FO-001' value={other} onChange={(e) => setOther(e.currentTarget.value)} data-testid='sgc-relacion-codigo' />
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Nota (opcional)' value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' description='Queda en la auditoría (mínimo 10 caracteres).' value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-relacion-motivo' />
          <Button
            loading={busy}
            data-testid='sgc-relacion-guardar'
            onClick={() =>
              save(async () => {
                const target = await fetch(`/api/sgc/documents?company=${idCompany}&status=todos`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
                const hit = (target?.documents as { idDocument: number; code: string }[] | undefined)?.find((d) => d.code.toUpperCase() === other.trim().toUpperCase());
                // El servidor también acepta el código directamente; el sentido define origen y destino.
                const body =
                  direction === 'sale'
                    ? { idSource: idDocument, ...(hit ? { idTarget: hit.idDocument } : { targetCode: other }), type, note, reason }
                    : hit
                      ? { idSource: hit.idDocument, idTarget: idDocument, type, note, reason }
                      : null;
                if (!body) throw new Error('No se encontró ese código entre los documentos de la empresa.');
                await sgcSend('/api/sgc/relations', 'POST', body);
              })
            }
          >
            Guardar relación
          </Button>
        </Stack>
      </Modal>

      <SgcParentLinkModal
        child={linking ? { idDocument, code } : null}
        via='boton'
        onClose={() => setLinking(false)}
        onDone={(message) => {
          setLinking(false);
          setDone(message);
          rel.reload();
          parentInfo.reload();
        }}
      />

      <Modal opened={!!removing} onClose={() => setRemoving(null)} title='Retirar relación' centered>
        <Stack>
          {error && <Alert color='red'>{error}</Alert>}
          <Text size='sm'>No se borra: queda retirada con su motivo en la auditoría.</Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button color='red' loading={busy} onClick={() => removing && save(() => sgcSend(`/api/sgc/relations/${removing.id}/remove`, 'POST', { reason }))}>
            Retirar
          </Button>
        </Stack>
      </Modal>
    </Card>
  );
}
