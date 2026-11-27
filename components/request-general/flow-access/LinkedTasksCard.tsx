'use client';

import { Card, Group, Stack, Switch, Text } from '@mantine/core';
import { IconSitemap } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface Row {
  id: number;
  task: string;
  linkedProcess: string | null;
  linkedMultiple: boolean;
}

/** «Tareas con flujo vinculado» (2026-11-26): permitir que una tarea cree varias solicitudes del flujo vinculado. */
export function LinkedTasksCard({ processId }: { processId: number }) {
  const [data, setData] = useState<{ canEdit: boolean; tasks: Row[] } | null>(null);
  const load = async () => {
    const res = await fetch(`/api/requests-general/linked-tasks?id=${processId}`, { cache: 'no-store' });
    if (res.ok) setData(await res.json());
  };
  useEffect(() => {
    void load();
  }, [processId]);
  if (!data || data.tasks.length === 0) return null;

  const toggle = async (t: Row, on: boolean) => {
    const res = await fetch('/api/requests-general/linked-tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: processId, tasks: [{ id: t.id, linkedMultiple: on }] }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(d.error || 'No se pudo guardar');
    else toast.success(on ? 'La tarea admite varias solicitudes vinculadas' : 'La tarea vuelve a una sola solicitud vinculada');
    await load();
  };

  return (
    <Card withBorder radius='md' p='md' data-testid='linked-tasks-card'>
      <Stack gap='sm'>
        <Group gap='xs'>
          <IconSitemap size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
          <Text size='sm' c='dimmed' fw={500}>
            Tareas con flujo vinculado
          </Text>
        </Group>
        {data.tasks.map((t) => (
          <Switch
            key={t.id}
            disabled={!data.canEdit}
            checked={t.linkedMultiple}
            onChange={(e) => void toggle(t, e.currentTarget.checked)}
            label={`${t.task} → ${t.linkedProcess ?? 'flujo vinculado'}: permitir varias solicitudes (la cierra su responsable)`}
          />
        ))}
      </Stack>
    </Card>
  );
}
