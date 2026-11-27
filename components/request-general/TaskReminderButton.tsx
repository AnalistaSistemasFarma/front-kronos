'use client';

import { Button } from '@mantine/core';
import { IconBellRinging } from '@tabler/icons-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

/** «Enviar recordatorio» al responsable de una actividad abierta (2026-11-24). */
export default function TaskReminderButton({ taskId }: { taskId: number }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/requests-general/task-reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el recordatorio');
      toast.success('Recordatorio enviado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar el recordatorio');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size='compact-xs' variant='light' color='orange' leftSection={<IconBellRinging size={12} />} loading={busy} onClick={() => void send()} data-testid='task-reminder'>
      Recordar
    </Button>
  );
}
