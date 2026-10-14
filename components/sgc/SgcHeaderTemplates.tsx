'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Image, Loader, Modal, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { IconCheck, IconEdit, IconEye, IconPlus, IconStar } from '@tabler/icons-react';
import SgcSelect from './SgcSelect';
import { sgcSend, useSgcFetch } from './useSgcFetch';
import { useSgcPdfPageImages } from './signature/useSgcPdfPageImages';
import { formatDateCO } from './tareas/format';
import { SGC_DEFAULT_HEADER_TEMPLATE, SGC_HEADER_BOTTOM_ROWS, SGC_HEADER_BOTTOM_ROW_LABELS, type SgcHeaderTemplateConfig } from '../../lib/sgc/headerTemplates';

/**
 * PLANTILLAS DE ENCABEZADO por tipo documental (S16, R31; decisión D20: una
 * por defecto y las demás se configuran por tipo). Misma pantalla que
 * «Personas por cargo» y «Aprobadores autorizados» (SgcCargoMembers,
 * SgcApprovers): texto de ayuda, botón arriba y tabla Mantine, con motivo en
 * cada cambio. La geometría del encabezado institucional no cambia (no se
 * mueven los recuadros de firma); se configuran los rótulos y la fila
 * inferior. Cada tipo documental elige su plantilla en «Tipos documentales».
 * Los documentos vigentes no cambian.
 */
interface Row {
  id: number;
  code: string;
  name: string;
  config: SgcHeaderTemplateConfig;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  documentTypes: { id: number; code: string; name: string }[];
}

type Editing = { id: number | null; code: string; name: string; config: SgcHeaderTemplateConfig; isActive: boolean; reason: string };

const LABEL_FIELDS: { key: keyof SgcHeaderTemplateConfig; label: string }[] = [
  { key: 'titleLabel', label: 'Rótulo del nombre' },
  { key: 'codeLabel', label: 'Rótulo del código' },
  { key: 'versionLabel', label: 'Rótulo de la versión' },
  { key: 'elaboroLabel', label: 'Rótulo «Elaboró»' },
  { key: 'revisoLabel', label: 'Rótulo «Revisó»' },
  { key: 'aproboLabel', label: 'Rótulo «Aprobó»' },
  { key: 'emissionLabel', label: 'Rótulo de la fecha de emisión' },
];

/** URL de la vista previa (plantilla guardada o la configuración que se está editando). */
export function headerPreviewUrl(idCompany: number, target: { id?: number | null; config?: SgcHeaderTemplateConfig | null }): string {
  if (target.config) {
    const json = JSON.stringify(target.config);
    const b64 = typeof window === 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(json)));
    return `/api/sgc/header-templates/preview?company=${idCompany}&config=${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  }
  return `/api/sgc/header-templates/preview?company=${idCompany}${target.id ? `&id=${target.id}` : ''}`;
}

function Preview({ url }: { url: string | null }) {
  const { pages, loading, error } = useSgcPdfPageImages(url, 1);
  if (!url) return null;
  if (error) return <Alert color='red'>{error}</Alert>;
  if (loading && !pages.length) return <Loader size='sm' />;
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm' data-testid='sgc-encabezado-vista-previa'>
      {pages.map((p) => (
        <Card key={p.page} withBorder p={4} radius='sm'>
          <Image src={p.dataUrl} alt={`Página ${p.page} de la vista previa del encabezado`} />
        </Card>
      ))}
    </SimpleGrid>
  );
}

export default function SgcHeaderTemplates({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<{ templates: Row[] }>(`/api/sgc/header-templates?company=${idCompany}`);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [previewOf, setPreviewOf] = useState<Row | null>(null);
  const [makeDefault, setMakeDefault] = useState<{ row: Row; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const rows = useMemo(() => data?.templates ?? [], [data]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setCfg = (k: keyof SgcHeaderTemplateConfig, v: string | null) => editing && setEditing({ ...editing, config: { ...editing.config, [k]: v } as SgcHeaderTemplateConfig });

  if (error) return <Alert color='red'>{error}</Alert>;
  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-encabezados'>
      <Stack>
        <Text size='sm' c='dimmed'>
          Plantillas del encabezado institucional por tipo documental (instructivos, formatos, procedimientos y manuales). La tabla del encabezado es la misma; cada plantilla define sus rótulos y la fila inferior. Los tipos sin plantilla propia usan la plantilla por defecto. Los documentos vigentes no cambian: el cambio aplica a los que se aprueben después. Cada cambio queda en el control de cambios con su motivo.
        </Text>
        {msg && <Alert color={msg.ok ? 'green' : 'red'} data-testid='sgc-encabezados-mensaje'>{msg.text}</Alert>}
        <Group>
          <Button
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              setLivePreview(null);
              setEditing({ id: null, code: '', name: '', config: { ...SGC_DEFAULT_HEADER_TEMPLATE }, isActive: true, reason: '' });
            }}
            data-testid='sgc-encabezado-nuevo'
          >
            Nueva plantilla
          </Button>
          <Button variant='default' leftSection={<IconEye size={14} />} onClick={() => setPreviewOf({ id: 0, code: 'INSTITUCIONAL', name: 'Encabezado institucional (sin plantillas)', config: SGC_DEFAULT_HEADER_TEMPLATE, isDefault: false, isActive: true, version: 0, updatedBy: '', updatedAt: '', documentTypes: [] })}>
            Ver el encabezado institucional
          </Button>
        </Group>
        <Table.ScrollContainer minWidth={720}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Plantilla</Table.Th>
                <Table.Th>Tipos documentales</Table.Th>
                <Table.Th>Versión</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Actualizada</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id} data-testid='sgc-encabezado-fila' data-code={r.code}>
                  <Table.Td>
                    <Text size='sm' fw={600}>
                      {r.name}
                    </Text>
                    <Text size='xs' c='dimmed' ff='monospace'>
                      {r.code}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs'>{r.documentTypes.length ? r.documentTypes.map((t) => t.code).join(', ') : r.isDefault ? 'Los tipos sin plantilla propia' : '—'}</Text>
                  </Table.Td>
                  <Table.Td>{r.version}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {r.isDefault && (
                      <Badge color='blue' variant='light' size='sm' mr={4} styles={{ label: { overflow: 'visible' } }}>
                        Por defecto
                      </Badge>
                    )}
                    <Badge color={r.isActive ? 'green' : 'gray'} variant='light' size='sm' styles={{ label: { overflow: 'visible' } }}>
                      {r.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs'>
                      {r.updatedBy} · {formatDateCO(r.updatedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap='nowrap'>
                      <Button size='xs' variant='subtle' leftSection={<IconEye size={12} />} onClick={() => setPreviewOf(r)}>
                        Vista previa
                      </Button>
                      <Button
                        size='xs'
                        variant='subtle'
                        leftSection={<IconEdit size={12} />}
                        onClick={() => {
                          setLivePreview(null);
                          setEditing({ id: r.id, code: r.code, name: r.name, config: { ...r.config }, isActive: r.isActive, reason: '' });
                        }}
                      >
                        Editar
                      </Button>
                      {!r.isDefault && r.isActive && (
                        <Button size='xs' variant='subtle' leftSection={<IconStar size={12} />} onClick={() => setMakeDefault({ row: r, reason: '' })}>
                          Por defecto
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {data && rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size='sm' c='dimmed'>
                      Aún no hay plantillas: todos los tipos usan el encabezado institucional.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <Modal opened={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Editar plantilla ${editing.code}` : 'Nueva plantilla de encabezado'} size='xl' centered>
        {editing && (
          <Stack>
            <Group grow align='flex-start'>
              <TextInput label='Código' value={editing.code} disabled={Boolean(editing.id)} onChange={(e) => setEditing({ ...editing, code: e.currentTarget.value.toUpperCase() })} ff='monospace' autoComplete='off' data-testid='sgc-encabezado-codigo' />
              <TextInput label='Nombre' value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} autoComplete='off' data-testid='sgc-encabezado-nombre' />
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
              {LABEL_FIELDS.map((f) => (
                <TextInput key={f.key} label={f.label} value={String(editing.config[f.key] ?? '')} onChange={(e) => setCfg(f.key, e.currentTarget.value)} autoComplete='off' />
              ))}
            </SimpleGrid>
            <Group grow align='flex-start'>
              <SgcSelect
                label='Fila inferior'
                data={SGC_HEADER_BOTTOM_ROWS.map((v) => ({ value: v, label: SGC_HEADER_BOTTOM_ROW_LABELS[v] }))}
                value={editing.config.bottomRow}
                onChange={(v) => setCfg('bottomRow', v ?? 'proceso_tipo')}
                allowDeselect={false}
                data-testid='sgc-encabezado-fila-inferior'
              />
              <TextInput label='Leyenda (opcional)' description='Si la fila inferior es «Una leyenda propia», es obligatoria.' value={editing.config.legend ?? ''} onChange={(e) => setCfg('legend', e.currentTarget.value)} autoComplete='off' data-testid='sgc-encabezado-leyenda' />
            </Group>
            <Group>
              <Button variant='default' leftSection={<IconEye size={14} />} onClick={() => setLivePreview(headerPreviewUrl(idCompany, { config: editing.config }))} data-testid='sgc-encabezado-ver'>
                Ver cómo queda
              </Button>
            </Group>
            <Preview url={livePreview} />
            <Textarea label='Motivo del cambio' description='Mínimo 5 caracteres: queda en el control de cambios.' autosize minRows={2} value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.currentTarget.value })} autoComplete='off' data-testid='sgc-encabezado-motivo' />
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button
                leftSection={<IconCheck size={14} />}
                loading={busy}
                disabled={editing.reason.trim().length < 5 || editing.name.trim().length < 3}
                onClick={async () => {
                  const ok = await act(
                    () => sgcSend('/api/sgc/header-templates', 'POST', { company: idCompany, action: 'guardar', id: editing.id, code: editing.code, name: editing.name, config: editing.config, isActive: editing.isActive, reason: editing.reason }),
                    editing.id ? 'Plantilla actualizada (sube su versión).' : 'Plantilla creada.'
                  );
                  if (ok) setEditing(null);
                }}
                data-testid='sgc-encabezado-guardar'
              >
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={Boolean(previewOf)} onClose={() => setPreviewOf(null)} title={`Vista previa · ${previewOf?.name ?? ''}`} size='xl' centered>
        {previewOf && <Preview url={headerPreviewUrl(idCompany, previewOf.id ? { id: previewOf.id } : { config: previewOf.config })} />}
      </Modal>

      <Modal opened={Boolean(makeDefault)} onClose={() => setMakeDefault(null)} title={`Marcar por defecto · ${makeDefault?.row.name ?? ''}`} centered>
        <Stack>
          <Text size='sm' c='dimmed'>
            Los tipos documentales sin plantilla propia usarán esta plantilla en los documentos que se aprueben desde ahora.
          </Text>
          <Textarea label='Motivo' required autosize minRows={2} value={makeDefault?.reason ?? ''} onChange={(e) => makeDefault && setMakeDefault({ ...makeDefault, reason: e.currentTarget.value })} autoComplete='off' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setMakeDefault(null)}>
              Volver
            </Button>
            <Button
              loading={busy}
              disabled={(makeDefault?.reason.trim().length ?? 0) < 5}
              onClick={async () => {
                if (!makeDefault) return;
                const ok = await act(() => sgcSend('/api/sgc/header-templates', 'POST', { company: idCompany, action: 'por_defecto', id: makeDefault.row.id, reason: makeDefault.reason }), 'Plantilla por defecto actualizada.');
                if (ok) setMakeDefault(null);
              }}
            >
              Marcar por defecto
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
