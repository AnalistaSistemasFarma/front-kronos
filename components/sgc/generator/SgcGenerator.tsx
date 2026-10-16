'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, Modal, NumberInput, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft, IconBan, IconCheck, IconEye, IconFileExport, IconFilePlus, IconInfoCircle, IconX } from '@tabler/icons-react';
import { sgcNoAutofill } from '../../../lib/sgc/autofill';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import type { SgcGeneratedView, SgcTemplateView } from '../../../lib/sgc/db/generator';
import { SGC_GENERATOR_FIELD_TYPES, SGC_GENERATOR_FIELD_TYPE_LABELS, SGC_GENERATOR_MAX_LENGTH, type SgcGeneratorField, type SgcGeneratorFieldType } from '../../../lib/sgc/generator';
import { SgcDocumentCode } from '../SgcBadges';
import SgcDocumentViewerModal from '../SgcDocumentViewerModal';
import SgcSelect from '../SgcSelect';
import { sgcHref } from '../useSgcCompany';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import { useSgcRowLink } from '../useSgcRowLink';

/**
 * GENERADOR DE DOCUMENTOS (plantillas aprobadas por Calidad) — piezas de
 * pantalla, con el mismo marcado de «Copias no controladas» (tarjetas con
 * borde, tablas a rayas, insignias suaves, avisos arriba y modales con motivo):
 *   - SgcAvailableTemplates: plantillas desde las que la persona genera hoy;
 *   - SgcGenerateForm: los campos permitidos, vista previa y emisión;
 *   - SgcMyGenerated / SgcGeneratedRegister: registros (visor, anulación);
 *   - SgcTemplatesManagement: proponer (gestión o Calidad) y aprobar (solo Calidad).
 */

const VERSION_COLOR: Record<string, string> = { pendiente: 'blue', aprobada: 'green', rechazada: 'red', reemplazada: 'gray' };
const STATE_COLOR: Record<string, string> = { disponible: 'green', sin_aprobar: 'blue', desactualizada: 'orange', documento_no_vigente: 'red', retirada: 'gray' };
const GENERATED_COLOR: Record<string, string> = { emitido: 'green', anulado: 'red' };
const NOWRAP = { whiteSpace: 'nowrap' } as const;

type Msg = { ok: boolean; text: string } | null;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function Feedback({ msg, onClose, testId }: { msg: Msg; onClose: () => void; testId: string }) {
  if (!msg) return null;
  return (
    <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} withCloseButton onClose={onClose} data-testid={testId}>
      {msg.text}
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Generar
// ---------------------------------------------------------------------------

type AvailableTemplate = { id: number; name: string; description: string | null; document: SgcTemplateView['document']; approvedVersion: SgcTemplateView['approvedVersion'] };

export function SgcAvailableTemplates({ idCompany }: { idCompany: number }) {
  const rowLink = useSgcRowLink();
  const { data, error, loading } = useSgcFetch<{ templates: AvailableTemplate[] }>(`/api/sgc/generator?company=${idCompany}&vista=disponibles`);
  const templates = data?.templates ?? [];
  return (
    <Card withBorder radius='md' p='lg' data-testid='sgc-generador-disponibles'>
      <Title order={5} mb='xs'>
        Plantillas aprobadas por Calidad
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        Elija una plantilla: solo llena los campos que Calidad permitió y el resto del documento es el texto aprobado. El resultado queda como registro con su propio código.
      </Text>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={16} />} mb='sm'>
          {error}
        </Alert>
      )}
      {loading && !data ? (
        <Group justify='center' my='lg'>
          <Loader />
        </Group>
      ) : templates.length === 0 ? (
        <Text size='sm' c='dimmed' data-testid='sgc-generador-sin-plantillas'>
          No hay plantillas aprobadas que usted pueda usar.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped highlightOnHover verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Plantilla</Table.Th>
                <Table.Th>Documento de origen</Table.Th>
                <Table.Th>Versión de la plantilla</Table.Th>
                <Table.Th>Campos editables</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {templates.map((t) => (
                <Table.Tr key={t.id} {...rowLink(sgcHref(`${SGC_BASE_URL}/generador/${t.id}`, idCompany))} data-testid='sgc-generador-plantilla'>
                  <Table.Td>
                    <Text size='sm' fw={500}>
                      {t.name}
                    </Text>
                    {t.description && (
                      <Text size='xs' c='dimmed'>
                        {t.description}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    <SgcDocumentCode code={t.document.code} versionNumber={t.document.currentVersionNumber} />
                  </Table.Td>
                  <Table.Td>v{t.approvedVersion?.versionNumber ?? '-'}</Table.Td>
                  <Table.Td>{t.approvedVersion?.fields.length ?? 0}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

type TemplateForGeneration = {
  id: number;
  name: string;
  description: string | null;
  state: string;
  stateLabel: string;
  stateMessage: string;
  document: SgcTemplateView['document'];
  approvedVersion: SgcTemplateView['approvedVersion'];
};

function FieldInput({ field, value, onChange }: { field: SgcGeneratorField; value: string; onChange: (v: string) => void }) {
  const common = {
    label: field.label,
    description: field.help ?? undefined,
    required: field.required,
    value,
    maxLength: field.maxLength,
    'data-testid': `sgc-generador-campo-${field.key}`,
    ...sgcNoAutofill(`generador-${field.key}`),
  };
  if (field.type === 'parrafo') return <Textarea {...common} autosize minRows={3} onChange={(e) => onChange(e.currentTarget.value)} />;
  return <TextInput {...common} type={field.type === 'fecha' ? 'date' : 'text'} inputMode={field.type === 'numero' ? 'decimal' : undefined} onChange={(e) => onChange(e.currentTarget.value)} />;
}

export function SgcGenerateForm({ idCompany, idTemplate }: { idCompany: number; idTemplate: number }) {
  const { data, error, loading } = useSgcFetch<TemplateForGeneration>(`/api/sgc/generator/templates/${idTemplate}?company=${idCompany}`);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'vista' | 'emitir' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [issued, setIssued] = useState<{ id: number; code: string } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const blobRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    []
  );
  const fields = data?.approvedVersion?.fields ?? [];
  const missing = fields.filter((f) => f.required && !(values[f.key] ?? '').trim());
  const back = sgcHref(`${SGC_BASE_URL}/generador`, idCompany);

  const openPreview = async () => {
    setBusy('vista');
    setMsg(null);
    try {
      const res = await fetch(`/api/sgc/generator/templates/${idTemplate}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: idCompany, modo: 'vista', values }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(await res.blob());
      setViewer({ url: blobRef.current, title: `Vista previa · ${data?.name ?? ''}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const issue = async () => {
    setBusy('emitir');
    setMsg(null);
    try {
      const out = await sgcSend<{ record: { id: number; code: string } }>(`/api/sgc/generator/templates/${idTemplate}/generate`, 'POST', { company: idCompany, modo: 'emitir', values });
      setIssued(out.record);
      setMsg({ ok: true, text: `Documento emitido: ${out.record.code}. Quedó en «Mis documentos» y en el registro de Calidad.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  if (error || !data) {
    return (
      <Stack>
        <Alert color='red' icon={<IconAlertTriangle size={16} />} title='No se pudo abrir la plantilla' data-testid='sgc-generador-error'>
          {error ?? 'No se encontró la plantilla.'}
        </Alert>
        <Group>
          <Button component={Link} href={back} variant='default' leftSection={<IconArrowLeft size={16} />}>
            Volver al generador
          </Button>
        </Group>
      </Stack>
    );
  }

  const available = data.state === 'disponible' && data.approvedVersion;
  return (
    <Stack gap='lg'>
      <Feedback msg={msg} onClose={() => setMsg(null)} testId='sgc-generador-mensaje' />
      {issued && (
        <Alert color='green' variant='light' icon={<IconFileExport size={16} />} title={`Registro ${issued.code}`} data-testid='sgc-generador-emitido'>
          <Group justify='space-between' wrap='wrap' gap='sm'>
            <Text size='sm'>El documento se generó con su código y quedó guardado. Se consulta en el visor, sin descarga.</Text>
            <Group gap='xs'>
              <Button size='xs' variant='light' leftSection={<IconEye size={14} />} onClick={() => setViewer({ url: `/api/sgc/generator/documents/${issued.id}/file`, title: issued.code })} data-testid='sgc-generador-ver-emitido'>
                Ver documento
              </Button>
              <Button size='xs' variant='default' onClick={() => { setIssued(null); setValues({}); setMsg(null); }}>
                Generar otro
              </Button>
            </Group>
          </Group>
        </Alert>
      )}
      <Card withBorder radius='md' p='lg'>
        <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
          <Stack gap={6}>
            <SgcDocumentCode code={data.document.code} versionNumber={data.document.currentVersionNumber} />
            <Text fw={600} size='lg' data-testid='sgc-generador-titulo'>
              {data.name}
            </Text>
            <Group gap={6}>
              <Badge variant='light' color={STATE_COLOR[data.state] ?? 'gray'}>
                {data.stateLabel}
              </Badge>
              {data.approvedVersion && (
                <Badge variant='light' color='gray'>
                  Plantilla v{data.approvedVersion.versionNumber} · aprobada por Calidad {fmt(data.approvedVersion.decidedAt).slice(0, 10)}
                </Badge>
              )}
            </Group>
          </Stack>
          <Button component={Link} href={back} variant='default' leftSection={<IconArrowLeft size={16} />}>
            Volver al generador
          </Button>
        </Group>
        <Alert mt='md' color='blue' variant='light' icon={<IconInfoCircle size={16} />}>
          {available
            ? `Solo puede llenar los campos que permitió Calidad. El resto del documento es el texto aprobado de ${data.document.code}; el encabezado y los campos de sistema los pone el sistema.`
            : data.stateMessage}
        </Alert>
      </Card>

      {available && !issued && (
        <Card withBorder radius='md' p='lg' data-testid='sgc-generador-formulario'>
          <Title order={5} mb='sm'>
            Campos editables
          </Title>
          <Stack>
            {fields.map((f) => (
              <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
            ))}
            <Group justify='flex-end' gap='xs'>
              <Button variant='default' leftSection={<IconEye size={16} />} loading={busy === 'vista'} disabled={busy !== null} onClick={() => void openPreview()} data-testid='sgc-generador-vista-previa'>
                Vista previa
              </Button>
              <Button leftSection={<IconFileExport size={16} />} loading={busy === 'emitir'} disabled={busy !== null || missing.length > 0} onClick={() => void issue()} data-testid='sgc-generador-emitir'>
                Emitir documento
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
      <SgcDocumentViewerModal fileUrl={viewer?.url ?? null} title={viewer?.title ?? ''} onClose={() => setViewer(null)} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Registros generados
// ---------------------------------------------------------------------------

function GeneratedTable({ idCompany, rows, showAuthor, onChanged, onMessage }: { idCompany: number; rows: SgcGeneratedView[]; showAuthor: boolean; onChanged: () => void; onMessage: (m: Msg) => void }) {
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [annulling, setAnnulling] = useState<SgcGeneratedView | null>(null);
  const [reason, setReason] = useState('');
  const annul = async () => {
    if (!annulling) return;
    try {
      await sgcSend(`/api/sgc/generator/documents/${annulling.id}/annul`, 'POST', { company: idCompany, reason });
      onMessage({ ok: true, text: `Documento ${annulling.code} anulado.` });
      setAnnulling(null);
      setReason('');
      onChanged();
    } catch (e) {
      onMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <>
      <Table.ScrollContainer minWidth={820}>
        <Table striped verticalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Código</Table.Th>
              <Table.Th>Plantilla</Table.Th>
              {showAuthor && <Table.Th>Generó</Table.Th>}
              <Table.Th>Fecha</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((g) => (
              <Table.Tr key={g.id} data-testid='sgc-generado'>
                <Table.Td style={NOWRAP}>
                  <Text size='sm' ff='monospace'>
                    {g.code}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>{g.templateName}</Text>
                  <Text size='xs' c='dimmed'>
                    {g.document.code} V{g.document.versionNumber ?? '-'} · plantilla v{g.templateVersion}
                  </Text>
                </Table.Td>
                {showAuthor && <Table.Td>{g.generatedBy}</Table.Td>}
                <Table.Td style={NOWRAP}>{fmt(g.generatedAt)}</Table.Td>
                <Table.Td>
                  <Badge color={GENERATED_COLOR[g.status] ?? 'gray'} variant='light'>
                    {g.statusLabel}
                  </Badge>
                  {g.annulReason && (
                    <Text size='xs' c='dimmed'>
                      {g.annulReason}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap='xs' wrap='nowrap'>
                    <Button size='xs' variant='light' leftSection={<IconEye size={14} />} onClick={() => setViewer({ url: `/api/sgc/generator/documents/${g.id}/file`, title: g.code })} data-testid='sgc-generado-ver'>
                      Ver documento
                    </Button>
                    {g.status === 'emitido' && (
                      <Button size='xs' variant='subtle' color='red' leftSection={<IconBan size={14} />} onClick={() => setAnnulling(g)} data-testid='sgc-generado-anular'>
                        Anular
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <SgcDocumentViewerModal fileUrl={viewer?.url ?? null} title={viewer?.title ?? ''} onClose={() => setViewer(null)} />
      <Modal opened={!!annulling} onClose={() => setAnnulling(null)} title='Anular documento generado' centered>
        {annulling && (
          <Stack>
            <Text size='sm'>{annulling.code} queda en el registro marcado «ANULADO»; su número no se reutiliza.</Text>
            <Textarea label='Motivo' description='Mínimo 10 caracteres: queda en el historial.' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} {...sgcNoAutofill('generador-anular-motivo')} data-testid='sgc-generado-motivo' />
            <Button color='red' disabled={reason.trim().length < 10} onClick={() => void annul()} data-testid='sgc-generado-confirmar-anular'>
              Anular
            </Button>
          </Stack>
        )}
      </Modal>
    </>
  );
}

export function SgcMyGenerated({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<{ documents: SgcGeneratedView[] }>(`/api/sgc/generator?company=${idCompany}&vista=mios`);
  const [msg, setMsg] = useState<Msg>(null);
  const rows = data?.documents ?? [];
  return (
    <Stack>
      <Feedback msg={msg} onClose={() => setMsg(null)} testId='sgc-generados-mensaje' />
      <Card withBorder radius='md' p='lg' data-testid='sgc-mis-generados'>
        <Title order={5} mb='sm'>
          Mis documentos generados
        </Title>
        {error && <Alert color='red'>{error}</Alert>}
        {rows.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Aún no ha generado documentos.
          </Text>
        ) : (
          <GeneratedTable idCompany={idCompany} rows={rows} showAuthor={false} onChanged={reload} onMessage={setMsg} />
        )}
      </Card>
    </Stack>
  );
}

export function SgcGeneratedRegister({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<{ documents: SgcGeneratedView[] }>(`/api/sgc/generator?company=${idCompany}&vista=calidad`);
  const [msg, setMsg] = useState<Msg>(null);
  if (error) return <Alert color='gray'>{error}</Alert>;
  const rows = data?.documents ?? [];
  return (
    <Stack>
      <Feedback msg={msg} onClose={() => setMsg(null)} testId='sgc-registro-mensaje' />
      <Card withBorder radius='md' p='lg' data-testid='sgc-generados-registro'>
        <Title order={5} mb='sm'>
          Registro de documentos generados
        </Title>
        {rows.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Todavía no se ha generado ningún documento en la empresa.
          </Text>
        ) : (
          <GeneratedTable idCompany={idCompany} rows={rows} showAuthor onChanged={reload} onMessage={setMsg} />
        )}
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Plantillas: proponer y decidir
// ---------------------------------------------------------------------------

type SourceResponse = {
  document: { idDocument: number; code: string; title: string; versionNumber: number; documentType: string };
  sourceFormat: 'docx' | 'html';
  fields: SgcGeneratorField[];
  template: { id: number; name: string; status: string } | null;
};

export function SgcTemplateProposalForm({ idCompany, initialDocument = null, onDone }: { idCompany: number; initialDocument?: string | null; onDone: (m: Msg) => void }) {
  // S19 (R34): solo vigentes de tipos «plantilla guía» (sin codificación); los codificados van por solicitud.
  const docs = useSgcFetch<{ guideTypes: string[]; documents: { idDocument: number; code: string; title: string; versionNumber: number | null; documentType: string }[] }>(`/api/sgc/generator/source?company=${idCompany}&vista=fuentes`);
  const [idDocument, setIdDocument] = useState<string | null>(initialDocument);
  const source = useSgcFetch<SourceResponse>(idDocument ? `/api/sgc/generator/source?company=${idCompany}&documento=${idDocument}` : null);
  const [fields, setFields] = useState<SgcGeneratorField[]>([]);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    setFields(source.data?.fields ?? []);
    setName(source.data?.template?.name ?? source.data?.document.title ?? '');
  }, [source.data]);
  const options = useMemo(() => (docs.data?.documents ?? []).map((d) => ({ value: String(d.idDocument), label: `${d.title} · ${d.documentType} · V${d.versionNumber ?? '-'}` })), [docs.data]);
  const update = (key: string, patch: Partial<SgcGeneratorField>) => setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await sgcSend<{ versionNumber: number }>('/api/sgc/generator/templates', 'POST', { company: idCompany, idDocument: Number(idDocument), name, fields: fields.map(({ key, type, required, maxLength, help }) => ({ key, type, required, maxLength, help })), reason });
      onDone({ ok: true, text: `Plantilla v${out.versionNumber} enviada a Aseguramiento de Calidad para su aprobación.` });
      setReason('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack data-testid='sgc-plantilla-formulario'>
      <Feedback msg={msg} onClose={() => setMsg(null)} testId='sgc-plantilla-mensaje' />
      <Text size='sm' c='dimmed'>
        La plantilla parte de un documento VIGENTE en Word o del editor. Marque en su contenido lo que la persona puede cambiar con {'{{CAMPO:Etiqueta}}'} (o {'{{CAMPO:Etiqueta|fecha}}'}); todo lo demás queda fijo. La aprueba Aseguramiento de Calidad.
      </Text>
      <Alert color='blue' variant='light' icon={<IconAlertTriangle size={16} />} data-testid='sgc-plantilla-solo-sin-codificacion'>
        El Generador es solo para documentos <b>sin codificación</b>: la plantilla parte de un vigente de un tipo documental marcado como «plantilla guía»
        {docs.data?.guideTypes.length ? ` (${docs.data.guideTypes.join(', ')})` : ''} y lo que se genera no lleva código documental. Los documentos codificados van por solicitud.
        {docs.data && docs.data.guideTypes.length === 0 && ' Hoy ningún tipo documental está marcado: Aseguramiento de Calidad lo marca en Configuración del SGC.'}
      </Alert>
      <SgcSelect label='Documento vigente de origen' required searchable data={options} value={idDocument} onChange={setIdDocument} nothingFoundMessage='No hay plantillas guía vigentes' data-testid='sgc-plantilla-documento' />
      {source.loading && (
        <Group justify='center'>
          <Loader size='sm' />
        </Group>
      )}
      {source.error && (
        <Alert color='red' icon={<IconAlertTriangle size={16} />} data-testid='sgc-plantilla-origen-error'>
          {source.error}
        </Alert>
      )}
      {source.data && (
        <>
          <TextInput label='Nombre de la plantilla' required value={name} onChange={(e) => setName(e.currentTarget.value)} {...sgcNoAutofill('generador-plantilla-nombre')} data-testid='sgc-plantilla-nombre' />
          {fields.length === 0 ? (
            <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
              El contenido de {source.data.document.code} no tiene campos {'{{CAMPO:…}}'}: sin campos editables no se puede proponer la plantilla.
            </Alert>
          ) : (
            <Table.ScrollContainer minWidth={720}>
              <Table striped verticalSpacing='xs' data-testid='sgc-plantilla-campos'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Campo detectado</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Largo máximo</Table.Th>
                    <Table.Th>Obligatorio</Table.Th>
                    <Table.Th>Ayuda</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {fields.map((f) => (
                    <Table.Tr key={f.key}>
                      <Table.Td>
                        <Text size='sm' fw={500}>
                          {f.label}
                        </Text>
                        <Text size='xs' c='dimmed' ff='monospace'>
                          {f.key}
                        </Text>
                      </Table.Td>
                      <Table.Td miw={150}>
                        <SgcSelect data={SGC_GENERATOR_FIELD_TYPES.map((t) => ({ value: t, label: SGC_GENERATOR_FIELD_TYPE_LABELS[t] }))} value={f.type} allowDeselect={false} onChange={(v) => v && update(f.key, { type: v as SgcGeneratorFieldType, maxLength: SGC_GENERATOR_MAX_LENGTH[v as SgcGeneratorFieldType] })} aria-label={`Tipo de ${f.label}`} />
                      </Table.Td>
                      <Table.Td miw={110}>
                        <NumberInput min={1} max={SGC_GENERATOR_MAX_LENGTH[f.type]} value={f.maxLength} onChange={(v) => update(f.key, { maxLength: Number(v) || 1 })} aria-label={`Largo máximo de ${f.label}`} />
                      </Table.Td>
                      <Table.Td>
                        <Checkbox checked={f.required} onChange={(e) => update(f.key, { required: e.currentTarget.checked })} aria-label={`${f.label} obligatorio`} />
                      </Table.Td>
                      <Table.Td miw={200}>
                        <TextInput value={f.help ?? ''} onChange={(e) => update(f.key, { help: e.currentTarget.value || null })} {...sgcNoAutofill(`generador-ayuda-${f.key}`)} aria-label={`Ayuda de ${f.label}`} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Textarea label='Motivo' description='Para qué sirve la plantilla o qué cambió (mínimo 10 caracteres): queda en el historial.' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} {...sgcNoAutofill('generador-plantilla-motivo')} data-testid='sgc-plantilla-motivo' />
          <Group justify='flex-end'>
            <Button leftSection={<IconFilePlus size={16} />} loading={busy} disabled={fields.length === 0 || reason.trim().length < 10 || !name.trim()} onClick={() => void submit()} data-testid='sgc-plantilla-proponer'>
              Enviar a aprobación de Calidad
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}

export function SgcTemplatesManagement({ idCompany }: { idCompany: number }) {
  const { data, error, reload } = useSgcFetch<{ canApprove: boolean; templates: SgcTemplateView[] }>(`/api/sgc/generator?company=${idCompany}&vista=gestion`);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ template: SgcTemplateView; version: SgcTemplateView['versions'][number]; decision: 'aprobar' | 'rechazar' } | null>(null);
  const [retiring, setRetiring] = useState<SgcTemplateView | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  if (error) return <Alert color='gray'>{error}</Alert>;
  if (!data) return null;
  const pending = data.templates.flatMap((t) => t.versions.filter((v) => v.status === 'pendiente').map((v) => ({ template: t, version: v })));
  const decide = async () => {
    if (!deciding) return;
    setMsg(null);
    try {
      await sgcSend(`/api/sgc/generator/versions/${deciding.version.id}/decision`, 'POST', { company: idCompany, decision: deciding.decision, reason });
      setMsg({ ok: true, text: deciding.decision === 'aprobar' ? `Plantilla «${deciding.template.name}» v${deciding.version.versionNumber} aprobada: ya se puede generar desde ella.` : 'Configuración rechazada.' });
      setDeciding(null);
      setReason('');
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const retire = async () => {
    if (!retiring) return;
    setMsg(null);
    try {
      await sgcSend(`/api/sgc/generator/templates/${retiring.id}/retire`, 'POST', { company: idCompany, reason });
      setMsg({ ok: true, text: `Plantilla «${retiring.name}» retirada.` });
      setRetiring(null);
      setReason('');
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Stack>
      <Feedback msg={msg} onClose={() => setMsg(null)} testId='sgc-plantillas-mensaje' />
      {creating ? (
        <Card withBorder radius='md' p='lg'>
          <Group justify='space-between' mb='sm'>
            <Title order={5}>Nueva plantilla o nueva versión</Title>
            <Button size='xs' variant='subtle' color='gray' onClick={() => setCreating(false)}>
              Cerrar
            </Button>
          </Group>
          <SgcTemplateProposalForm
            idCompany={idCompany}
            onDone={(m) => {
              setMsg(m);
              setCreating(false);
              reload();
            }}
          />
        </Card>
      ) : (
        <Group justify='flex-end'>
          <Button leftSection={<IconFilePlus size={16} />} onClick={() => setCreating(true)} data-testid='sgc-plantilla-nueva'>
            Nueva plantilla
          </Button>
        </Group>
      )}
      {data.canApprove && (
        <Card withBorder radius='md' p='lg' data-testid='sgc-plantillas-por-aprobar'>
          <Title order={5} mb='sm'>
            Por aprobar ({pending.length})
          </Title>
          {pending.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No hay plantillas pendientes.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={760}>
              <Table striped verticalSpacing='xs'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Plantilla</Table.Th>
                    <Table.Th>Propuso</Table.Th>
                    <Table.Th>Campos editables</Table.Th>
                    <Table.Th>Motivo</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pending.map(({ template, version }) => (
                    <Table.Tr key={version.id} data-testid='sgc-plantilla-pendiente'>
                      <Table.Td>
                        <Text size='sm' fw={500}>
                          {template.name} · v{version.versionNumber}
                        </Text>
                        <Text size='xs' c='dimmed' ff='monospace'>
                          {template.document.code} V{version.documentVersionNumber ?? '-'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{version.proposedBy}</Text>
                        <Text size='xs' c='dimmed'>
                          {fmt(version.proposedAt)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{version.fields.map((f) => `${f.label} (${SGC_GENERATOR_FIELD_TYPE_LABELS[f.type]}${f.required ? ', obligatorio' : ''})`).join(' · ')}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{version.changeReason}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap='xs' wrap='nowrap'>
                          <Button size='xs' color='green' leftSection={<IconCheck size={14} />} onClick={() => setDeciding({ template, version, decision: 'aprobar' })} data-testid='sgc-plantilla-aprobar'>
                            Aprobar
                          </Button>
                          <Button size='xs' color='red' variant='light' leftSection={<IconX size={14} />} onClick={() => setDeciding({ template, version, decision: 'rechazar' })} data-testid='sgc-plantilla-rechazar'>
                            Rechazar
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
      <Card withBorder radius='md' p='lg' data-testid='sgc-plantillas-listado'>
        <Title order={5} mb='sm'>
          Plantillas y versiones
        </Title>
        {data.templates.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Aún no hay plantillas configuradas.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table striped verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Plantilla</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Versiones</Table.Th>
                  <Table.Th>Generados</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.templates.map((t) => (
                  <Table.Tr key={t.id} data-testid='sgc-plantilla-fila'>
                    <Table.Td>
                      <Text size='sm' fw={500}>
                        {t.name}
                      </Text>
                      <Text size='xs' c='dimmed' ff='monospace'>
                        {t.document.code} V{t.document.currentVersionNumber ?? '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATE_COLOR[t.state] ?? 'gray'} variant='light'>
                        {t.stateLabel}
                      </Badge>
                      {t.stateMessage && (
                        <Text size='xs' c='dimmed'>
                          {t.stateMessage}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4}>
                        {t.versions.map((v) => (
                          <Group key={v.id} gap={6} wrap='wrap'>
                            <Badge size='sm' color={VERSION_COLOR[v.status] ?? 'gray'} variant='light' style={{ flexShrink: 0 }}>
                              v{v.versionNumber} · {v.statusLabel}
                            </Badge>
                            <Text size='xs' c='dimmed'>
                              {v.decidedBy ? `${v.decidedBy} · ${fmt(v.decidedAt)}` : `propuso ${v.proposedBy}`}
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </Table.Td>
                    <Table.Td>{t.generatedCount}</Table.Td>
                    <Table.Td>
                      {data.canApprove && t.status === 'activa' && (
                        <Button size='xs' variant='subtle' color='red' leftSection={<IconBan size={14} />} onClick={() => setRetiring(t)} data-testid='sgc-plantilla-retirar'>
                          Retirar
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
      <Modal opened={!!deciding} onClose={() => setDeciding(null)} title={deciding?.decision === 'aprobar' ? 'Aprobar plantilla' : 'Rechazar plantilla'} centered>
        {deciding && (
          <Stack>
            <Text size='sm'>
              {deciding.template.name} v{deciding.version.versionNumber} ({deciding.template.document.code}) · propuso {deciding.version.proposedBy}. Al aprobarla, las personas generan documentos llenando solo sus campos editables.
            </Text>
            <Textarea label='Motivo' description='Mínimo 10 caracteres: queda en el historial.' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} {...sgcNoAutofill('generador-decision-motivo')} data-testid='sgc-plantilla-decision-motivo' />
            <Button color={deciding.decision === 'aprobar' ? 'green' : 'red'} disabled={reason.trim().length < 10} onClick={() => void decide()} data-testid='sgc-plantilla-confirmar'>
              {deciding.decision === 'aprobar' ? 'Aprobar' : 'Rechazar'}
            </Button>
          </Stack>
        )}
      </Modal>
      <Modal opened={!!retiring} onClose={() => setRetiring(null)} title='Retirar plantilla' centered>
        {retiring && (
          <Stack>
            <Text size='sm'>Desde «{retiring.name}» ya no se podrá generar. Los documentos ya emitidos se conservan.</Text>
            <Textarea label='Motivo' description='Mínimo 10 caracteres: queda en el historial.' required autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} {...sgcNoAutofill('generador-retiro-motivo')} />
            <Button color='red' disabled={reason.trim().length < 10} onClick={() => void retire()}>
              Retirar
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
