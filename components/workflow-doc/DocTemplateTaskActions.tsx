'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconFileText, IconPencil, IconSend } from '@tabler/icons-react';
import { DocTemplateEditor } from './DocTemplateEditor';

/**
 * Franja de acciones de las tareas «Plantilla de documento» dentro de «Archivos adjuntos».
 * Los documentos generados se ven en la lista de adjuntos con el distintivo «Autogenerado»;
 * aquí solo queda lo del modo «revisar»: Generar / Reemitir y, en el motor editor, Editar y
 * emitir (cada emisión es una versión). También avisa el error de una tarea automática.
 * Sin tareas abiertas que la persona pueda emitir (ni con error) no muestra nada.
 */

interface DocTask {
  id: number;
  idTask: number;
  task: string;
  status: number;
  mode: 'auto' | 'revisar';
  engine: 'editor' | 'word';
  error: string | null;
  canEmit: boolean;
}

async function readJson(r: Response) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
  return d;
}

export function DocTemplateTaskActions({ requestId, onEmitted }: { requestId: number | null | undefined; onEmitted?: () => void }) {
  const [tasks, setTasks] = useState<DocTask[]>([]);
  const [emittedTasks, setEmittedTasks] = useState<Set<number>>(new Set());
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
        setEmittedTasks(new Set(((d.documents ?? []) as { id_task: number }[]).map((x) => x.id_task)));
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

  const visible = tasks.filter((t) => t.status !== 2 && t.status !== 3 && (t.canEmit || t.error));
  if (!requestId || (visible.length === 0 && !notice)) return null;

  return (
    <Stack gap={6} mb='sm'>
      {error && (
        <Alert color='red' variant='light' p='xs' withCloseButton onClose={() => setError(null)}>
          <Text size='xs'>{error}</Text>
        </Alert>
      )}
      {notice && (
        <Alert color='teal' variant='light' p='xs' withCloseButton onClose={() => setNotice(null)}>
          <Text size='xs'>{notice}</Text>
        </Alert>
      )}
      {visible.map((t) => (
        <Alert key={t.id} color={t.error ? 'red' : 'violet'} variant='light' p='xs' icon={<IconFileText size={16} />}>
          <Group justify='space-between' gap='xs' wrap='wrap'>
            <div>
              <Text size='sm' fw={500}>
                {t.task}
              </Text>
              {t.error && <Text size='xs'>{t.error}</Text>}
            </div>
            {t.canEmit && (
              <Group gap='xs'>
                {t.engine === 'editor' && t.mode === 'revisar' && (
                  <Button size='xs' variant='light' color='violet' leftSection={<IconPencil size={14} />} loading={busy === t.id} onClick={() => openEditor(t)}>
                    Editar y emitir
                  </Button>
                )}
                <Button size='xs' color='violet' leftSection={<IconSend size={14} />} loading={busy === t.id} onClick={() => emit(t)}>
                  {emittedTasks.has(t.idTask) ? 'Reemitir' : 'Generar documento'}
                </Button>
              </Group>
            )}
          </Group>
        </Alert>
      ))}

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
    </Stack>
  );
}
