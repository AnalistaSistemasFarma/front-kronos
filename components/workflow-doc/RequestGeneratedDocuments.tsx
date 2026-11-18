'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { IconFileText, IconFileTypePdf, IconFileWord, IconPencil, IconSend } from '@tabler/icons-react';
import { DocTemplateEditor } from './DocTemplateEditor';

/**
 * Documentos generados por las tareas «Plantilla de documento» de una solicitud (vista de la
 * solicitud y de la actividad). En modo «revisar», el responsable genera/emite desde aquí; en el
 * motor editor puede abrir el documento ya lleno, ajustarlo y emitir. Cada emisión es una versión.
 * No se muestra nada si la solicitud no tiene tareas de este tipo.
 */

interface DocTask {
  id: number;
  idTask: number;
  task: string;
  status: number;
  mode: 'auto' | 'revisar';
  engine: 'editor' | 'word';
  output: 'pdf' | 'pdf_docx';
  error: string | null;
  canEmit: boolean;
}

interface GeneratedDoc {
  id: number;
  id_task: number;
  version: number;
  file_name: string;
  pdf_item_id: string | null;
  docx_item_id: string | null;
  source_label: string | null;
  status: string;
  generated_by: string | null;
  generated_at: string;
}

const fileUrl = (requestId: number, itemId: string) =>
  `/api/requests-general/attachment-file?requestId=${encodeURIComponent(String(requestId))}&fileId=${encodeURIComponent(itemId)}&storagePath=SG&entityType=Request`;

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
};

async function readJson(r: Response) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
  return d;
}

export function RequestGeneratedDocuments({ requestId, onEmitted }: { requestId: number | null | undefined; onEmitted?: () => void }) {
  const [tasks, setTasks] = useState<DocTask[]>([]);
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ task: DocTask; html: string } | null>(null);
  const [editedHtml, setEditedHtml] = useState('');

  const load = useCallback(() => {
    if (!requestId) return;
    fetch(`/api/workflow-doc/documents?id_request=${requestId}`, { cache: 'no-store' })
      .then(readJson)
      .then((d) => {
        setTasks(d.tasks ?? []);
        setDocs(d.documents ?? []);
      })
      .catch(() => undefined);
  }, [requestId]);

  useEffect(load, [load]);

  const emit = async (task: DocTask, html?: string) => {
    setBusy(task.id);
    setError(null);
    setNotice(null);
    try {
      const d = await readJson(
        await fetch('/api/workflow-doc/emit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_task_request: task.id, action: 'emit', html }),
        })
      );
      const missing = d.document?.unknown?.length ? ` Marcas sin campo: ${d.document.unknown.join(', ')}.` : '';
      setNotice(`Documento emitido: ${d.document.fileName} (versión ${d.document.version}).${missing}`);
      setEditing(null);
      load();
      onEmitted?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openEditor = async (task: DocTask) => {
    setBusy(task.id);
    setError(null);
    try {
      const d = await readJson(
        await fetch('/api/workflow-doc/emit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_task_request: task.id, action: 'preview' }),
        })
      );
      setEditedHtml(d.html ?? '');
      setEditing({ task, html: d.html ?? '' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!requestId || tasks.length === 0) return null;

  return (
    <Card shadow='sm' withBorder radius='md' p='lg' mt='6'>
      <Stack gap='sm'>
        <Group gap='xs'>
          <IconFileText size={18} className='text-violet-600' />
          <Text fw={600}>Documentos generados</Text>
        </Group>
        {error && (
          <Alert color='red' variant='light' withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color='teal' variant='light' withCloseButton onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {tasks.map((t) => {
          const list = docs.filter((d) => d.id_task === t.idTask);
          const open = t.status !== 2 && t.status !== 3;
          return (
            <Stack key={t.id} gap={6}>
              <Group justify='space-between'>
                <Group gap='xs'>
                  <Text size='sm' fw={500}>
                    {t.task}
                  </Text>
                  <Badge size='xs' variant='light' color={t.mode === 'auto' ? 'blue' : 'violet'}>
                    {t.mode === 'auto' ? 'Automática' : 'Revisar antes de emitir'}
                  </Badge>
                </Group>
                {open && t.canEmit && (
                  <Group gap='xs'>
                    {t.engine === 'editor' && t.mode === 'revisar' && (
                      <Button size='xs' variant='light' color='violet' leftSection={<IconPencil size={14} />} loading={busy === t.id} onClick={() => openEditor(t)}>
                        Editar y emitir
                      </Button>
                    )}
                    <Button size='xs' color='violet' leftSection={<IconSend size={14} />} loading={busy === t.id} onClick={() => emit(t)}>
                      {list.length ? 'Reemitir' : 'Generar documento'}
                    </Button>
                  </Group>
                )}
              </Group>
              {t.error && open && (
                <Alert color='red' variant='light' p='xs'>
                  <Text size='xs'>{t.error}</Text>
                </Alert>
              )}
              {list.length === 0 ? (
                <Text size='xs' c='dimmed'>
                  Aún no se ha generado el documento.
                </Text>
              ) : (
                <Table withTableBorder striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Versión</Table.Th>
                      <Table.Th>Archivo</Table.Th>
                      <Table.Th>Generado</Table.Th>
                      <Table.Th>Por</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {list.map((d) => (
                      <Table.Tr key={d.id}>
                        <Table.Td>
                          <Badge size='sm' variant='light' color={d.status === 'anulado' ? 'gray' : 'violet'}>
                            v{d.version}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size='xs'>{d.file_name}</Text>
                          {d.source_label && (
                            <Text size='xs' c='dimmed'>
                              {d.source_label}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size='xs'>{fmt(d.generated_at)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='xs'>{d.generated_by ?? '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap='xs' wrap='nowrap'>
                            {d.pdf_item_id && (
                              <Anchor size='xs' href={fileUrl(requestId, d.pdf_item_id)} target='_blank' rel='noreferrer'>
                                <Group gap={2} wrap='nowrap'>
                                  <IconFileTypePdf size={14} /> PDF
                                </Group>
                              </Anchor>
                            )}
                            {d.docx_item_id && (
                              <Anchor size='xs' href={`${fileUrl(requestId, d.docx_item_id)}&download=1`} target='_blank' rel='noreferrer'>
                                <Group gap={2} wrap='nowrap'>
                                  <IconFileWord size={14} /> Word
                                </Group>
                              </Anchor>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          );
        })}
      </Stack>

      <Modal opened={Boolean(editing)} onClose={() => setEditing(null)} size='xl' radius='lg' title={<Text fw={600}>Ajustar y emitir · {editing?.task.task}</Text>}>
        {editing && (
          <Stack gap='md'>
            <Text size='sm' c='dimmed'>
              El documento ya tiene los valores de la solicitud. Ajuste lo necesario y emita: cada emisión queda como una versión nueva.
            </Text>
            <DocTemplateEditor initialHtml={editing.html} markers={[]} withMentions={false} onChange={setEditedHtml} minHeight={420} />
            <Group justify='flex-end'>
              <Button variant='default' onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button color='violet' leftSection={<IconSend size={14} />} loading={busy === editing.task.id} onClick={() => emit(editing.task, editedHtml)}>
                Emitir
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}
