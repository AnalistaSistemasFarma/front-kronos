'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  CopyButton,
  FileInput,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconCopy, IconFileText, IconUpload, IconX } from '@tabler/icons-react';
import { wordTag, type DocMarker } from '../../lib/workflow-doc/fields';
import { DocTemplateEditor } from './DocTemplateEditor';

/**
 * Configuración de la tarea «Plantilla de documento» (pantalla «Ver flujos»): motor (editor de
 * SynerLink o Word), origen (Word subido o vigente del SGC), modo (automático o revisar antes de
 * emitir), salida y patrón del nombre del archivo.
 */

type Engine = 'editor' | 'word';
type Source = 'upload' | 'sgc';

interface Config {
  engine: Engine;
  source: Source;
  id_sgc_document: number | null;
  id_sgc_version: number | null;
  source_item_id: string | null;
  source_file_name: string | null;
  template_html: string | null;
  output: 'pdf' | 'pdf_docx';
  mode: 'auto' | 'revisar';
  file_name_pattern: string | null;
  /** 2026-11-26: anexar al PDF las imágenes adjuntas de la solicitud. */
  append_images?: boolean | null;
}

interface SgcDoc {
  idDocument: number;
  code: string;
  title: string;
  versionNumber: number | null;
  documentType: string;
  format: 'docx' | 'html' | null;
}

interface WordTagReport {
  tag: string;
  key: string | null;
}

const EMPTY: Config = {
  engine: 'editor',
  source: 'upload',
  id_sgc_document: null,
  id_sgc_version: null,
  source_item_id: null,
  source_file_name: null,
  template_html: '',
  output: 'pdf',
  mode: 'auto',
  file_name_pattern: '',
  append_images: false,
};

/** Distintivo de la tarjeta de la tarea + acceso a la configuración. */
export function TaskDocTemplateCardInfo({ idTask, onConfigure }: { idTask: number; onConfigure: () => void }) {
  return (
    <>
      <Badge color='violet' variant='light' size='sm' leftSection={<IconFileText size={12} />}>
        Plantilla de documento
      </Badge>
      {idTask > 0 ? (
        <Button size='compact-xs' variant='subtle' color='violet' onClick={onConfigure}>
          Configurar plantilla
        </Button>
      ) : (
        <Text size='xs' c='dimmed'>
          Guarde el flujo para configurar la plantilla
        </Text>
      )}
    </>
  );
}

async function readJson(r: Response) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
  return d;
}

export function TaskDocTemplateConfigModal({ task, onClose }: { task: { id: number; task: string } | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config>(EMPTY);
  const [markers, setMarkers] = useState<DocMarker[]>([]);
  const [html, setHtml] = useState('');
  const [editorSeed, setEditorSeed] = useState('');
  const [tags, setTags] = useState<WordTagReport[] | null>(null);
  const [sgcDocs, setSgcDocs] = useState<SgcDoc[] | null>(null);
  const [sgcLabel, setSgcLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOk(null);
    setTags(null);
    setSgcLabel(null);
    fetch(`/api/workflow-doc/task-template?id_task=${task.id}`, { cache: 'no-store' })
      .then(readJson)
      .then((d) => {
        if (cancelled) return;
        const c: Config = d.config ? { ...EMPTY, ...d.config } : EMPTY;
        setCfg(c);
        setMarkers(d.markers ?? []);
        setHtml(c.template_html ?? '');
        setEditorSeed(c.template_html ?? '');
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [task]);

  useEffect(() => {
    if (!task || cfg.source !== 'sgc' || sgcDocs) return;
    fetch(`/api/workflow-doc/sgc-sources?id_task=${task.id}`, { cache: 'no-store' })
      .then(readJson)
      .then((d) => setSgcDocs(d.documents ?? []))
      .catch((e) => setError(e.message));
  }, [task, cfg.source, sgcDocs]);

  const applyPrepared = (d: { html?: string | null; tags?: WordTagReport[] | null }) => {
    if (d.html != null) {
      setHtml(d.html);
      setEditorSeed(d.html);
    }
    setTags(d.tags ?? null);
  };

  const upload = async (file: File | null) => {
    if (!task || !file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('id_task', String(task.id));
      fd.append('engine', cfg.engine);
      fd.append('file', file);
      const d = await readJson(await fetch('/api/workflow-doc/upload-template', { method: 'POST', body: fd }));
      setCfg((c) => ({ ...c, source: 'upload', source_item_id: d.source_item_id, source_file_name: d.source_file_name, id_sgc_document: null }));
      applyPrepared(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const takeSgc = async (idDocument: string | null) => {
    if (!task || !idDocument) return;
    setBusy(true);
    setError(null);
    try {
      const d = await readJson(
        await fetch('/api/workflow-doc/sgc-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_task: task.id, id_document: Number(idDocument), engine: cfg.engine }),
        })
      );
      setCfg((c) => ({ ...c, source: 'sgc', id_sgc_document: d.id_sgc_document, id_sgc_version: d.id_sgc_version, source_item_id: d.source_item_id, source_file_name: d.source_file_name }));
      setSgcLabel(d.label);
      applyPrepared(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!task) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      await readJson(
        await fetch('/api/workflow-doc/task-template', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_task: task.id, ...cfg, template_html: cfg.engine === 'editor' ? html : null }),
        })
      );
      setOk('Plantilla guardada.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fieldMarkers = markers;

  return (
    <Modal
      opened={Boolean(task)}
      onClose={onClose}
      size='xl'
      radius='lg'
      title={
        <Group gap='xs'>
          <IconFileText size={20} className='text-violet-600' />
          <Text fw={600}>Plantilla de documento · {task?.task}</Text>
        </Group>
      }
    >
      {loading ? (
        <Group justify='center' p='xl'>
          <Loader size='sm' />
        </Group>
      ) : (
        <Stack gap='md'>
          {error && (
            <Alert color='red' variant='light' withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {ok && (
            <Alert color='teal' variant='light' withCloseButton onClose={() => setOk(null)}>
              {ok}
            </Alert>
          )}

          <div>
            <Text size='sm' fw={500} mb={4}>
              Motor
            </Text>
            <SegmentedControl
              fullWidth
              value={cfg.engine}
              onChange={(v) => {
                setCfg((c) => ({ ...c, engine: v as Engine, output: v === 'editor' ? 'pdf' : c.output, source_item_id: null, source_file_name: null, id_sgc_document: null }));
                setTags(null);
                setSgcLabel(null);
              }}
              data={[
                { label: 'Editor SynerLink', value: 'editor' },
                { label: 'Word', value: 'word' },
              ]}
            />
          </div>

          <Group grow align='flex-start'>
            <div>
              <Text size='sm' fw={500} mb={4}>
                Modo
              </Text>
              <SegmentedControl
                fullWidth
                value={cfg.mode}
                onChange={(v) => setCfg((c) => ({ ...c, mode: v as Config['mode'] }))}
                data={[
                  { label: 'Automático', value: 'auto' },
                  { label: 'Revisar antes de emitir', value: 'revisar' },
                ]}
              />
              <Text size='xs' c='dimmed' mt={4}>
                {cfg.mode === 'auto'
                  ? 'Sin responsable: el sistema genera el documento, cierra la tarea y avanza el flujo.'
                  : 'La tarea le llega a su responsable, que genera (y en el editor ajusta) el documento antes de emitir.'}
              </Text>
            </div>
            <div>
              <Text size='sm' fw={500} mb={4}>
                Salida
              </Text>
              <SegmentedControl
                fullWidth
                value={cfg.output}
                onChange={(v) => setCfg((c) => ({ ...c, output: v as Config['output'] }))}
                data={[
                  { label: 'PDF', value: 'pdf' },
                  { label: 'PDF + Word', value: 'pdf_docx', disabled: cfg.engine === 'editor' },
                ]}
              />
            </div>
          </Group>

          <TextInput
            label='Nombre del archivo'
            description='Admite marcas, p. ej. «Contrato @{N.º de solicitud} - @{Razón social}». Vacío: «Documento solicitud N».'
            value={cfg.file_name_pattern ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setCfg((c) => ({ ...c, file_name_pattern: v }));
            }}
            maxLength={200}
          />

          <Switch
            label='Anexar al PDF las imágenes adjuntas de la solicitud (JPG o PNG, una por página)'
            description='Para informes con evidencias fotográficas, p. ej. el informe de auditoría.'
            checked={Boolean(cfg.append_images)}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setCfg((c) => ({ ...c, append_images: v }));
            }}
          />

          <div>
            <Text size='sm' fw={500} mb={4}>
              Origen de la plantilla
            </Text>
            <SegmentedControl
              fullWidth
              value={cfg.source}
              onChange={(v) => setCfg((c) => ({ ...c, source: v as Source }))}
              data={[
                { label: 'Subir Word', value: 'upload' },
                { label: 'Documento vigente del SGC', value: 'sgc' },
              ]}
            />
          </div>

          {cfg.source === 'upload' ? (
            <FileInput
              label='Word de la plantilla (.docx)'
              description={
                cfg.engine === 'word'
                  ? 'Escriba en el Word las marcas @{Etiqueta del campo}; se llenan conservando el formato.'
                  : 'Se convierte para editarlo aquí; las marcas @{Etiqueta} que coincidan quedan como campos.'
              }
              placeholder={cfg.source_file_name || 'Seleccione un .docx'}
              accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              leftSection={busy ? <Loader size={14} /> : <IconUpload size={16} />}
              onChange={upload}
              disabled={busy}
              clearable
            />
          ) : (
            <Select
              label='Documento vigente del SGC'
              description='Se usa la versión vigente; si el documento cambia de versión, la tarea deja de generar hasta que se vuelva a guardar esta configuración.'
              placeholder={sgcDocs ? 'Busque por código o título' : 'Cargando…'}
              searchable
              data={(sgcDocs ?? [])
                .filter((d) => d.format && (cfg.engine === 'editor' || d.format === 'docx'))
                .map((d) => ({ value: String(d.idDocument), label: `${d.code} v${d.versionNumber ?? '?'} — ${d.title} (${d.documentType})` }))}
              value={cfg.id_sgc_document ? String(cfg.id_sgc_document) : null}
              onChange={takeSgc}
              disabled={busy}
              nothingFoundMessage='Sin documentos vigentes con Word en las empresas del flujo'
            />
          )}
          {sgcLabel && (
            <Text size='xs' c='dimmed'>
              Origen: {sgcLabel}
            </Text>
          )}

          {cfg.engine === 'editor' ? (
            <div>
              <Text size='sm' fw={500} mb={4}>
                Contenido (escriba «@» para insertar un campo)
              </Text>
              <DocTemplateEditor initialHtml={editorSeed} markers={markers} onChange={setHtml} />
            </div>
          ) : (
            <Stack gap='xs'>
              {cfg.source_file_name && !tags && (
                <Text size='sm'>
                  Word configurado: <b>{cfg.source_file_name}</b>
                </Text>
              )}
              {tags && (
                <>
                  <Text size='sm' fw={500}>
                    Marcas detectadas en el Word
                  </Text>
                  {tags.length === 0 ? (
                    <Text size='sm' c='dimmed'>
                      El Word no tiene marcas @{'{'}…{'}'}.
                    </Text>
                  ) : (
                    <Group gap={6}>
                      {tags.map((t) => (
                        <Badge
                          key={t.tag}
                          color={t.key ? 'teal' : 'red'}
                          variant='light'
                          leftSection={t.key ? <IconCheck size={12} /> : <IconX size={12} />}
                          styles={{ root: { textTransform: 'none' } }}
                        >
                          {t.tag}
                        </Badge>
                      ))}
                    </Group>
                  )}
                  {tags.some((t) => !t.key) && (
                    <Alert color='yellow' variant='light'>
                      Las marcas en rojo no corresponden a ningún campo del proceso: quedarán vacías.
                    </Alert>
                  )}
                </>
              )}
              <Text size='sm' fw={500}>
                Campos disponibles (copie la marca y péguela en el Word)
              </Text>
              <Table striped highlightOnHover withTableBorder>
                <Table.Tbody>
                  {fieldMarkers.map((m) => (
                    <Table.Tr key={m.key}>
                      <Table.Td>
                        <Text size='sm'>{m.label}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='xs' ff='monospace'>
                          {wordTag(m.label)}
                        </Text>
                      </Table.Td>
                      <Table.Td w={40}>
                        <CopyButton value={wordTag(m.label)}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copiada' : 'Copiar'} withArrow>
                              <Button size='compact-xs' variant='subtle' color={copied ? 'teal' : 'gray'} onClick={copy}>
                                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              </Button>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}

          <Group justify='flex-end'>
            <Button variant='default' onClick={onClose}>
              Cerrar
            </Button>
            <Button color='violet' onClick={save} loading={saving} disabled={busy}>
              Guardar plantilla
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
