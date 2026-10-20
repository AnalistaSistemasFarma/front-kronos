'use client';

import { useEffect, useState } from 'react';
import { Switch, Tooltip } from '@mantine/core';

/**
 * Interruptor "Cerrar al firmar": si está activo, cuando todos los documentos de una
 * solicitud propia quedan firmados se cierran sus tareas de firma (la solicitud sigue
 * abierta). Activado por defecto; quien no lo quiera lo apaga.
 */
export function SignatureAutoCloseToggle() {
  const [enabled, setEnabled] = useState(true);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile/signature-auto-close', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { available?: boolean; enabled?: boolean }) => {
        if (cancelled) return;
        setAvailable(data.available !== false);
        setEnabled(data.enabled !== false);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/profile/signature-auto-close', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'No se pudo guardar');
      }
    } catch (err) {
      setEnabled(previous);
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setLoading(false);
    }
  }

  const help = !available
    ? 'Activado para todos: cuando todos terminen de firmar se cierra la tarea de firma (la solicitud sigue abierta). Todavía no se puede desactivar.'
    : enabled
      ? 'Activado: cuando todos terminen de firmar se cierra sola la tarea de firma y la solicitud sigue con lo que falte. Apágalo si prefieres cerrar la tarea tú.'
      : 'Desactivado: al terminar de firmar, la tarea de firma queda abierta para que la cierres tú.';

  return (
    <Tooltip label={error || help} multiline w={300} withArrow color={error ? 'red' : undefined}>
      <div>
        <Switch
          label='Cerrar al terminar de firmar'
          checked={enabled}
          disabled={loading || !available}
          onChange={(e) => handleChange(e.currentTarget.checked)}
          error={error ? true : undefined}
        />
      </div>
    </Tooltip>
  );
}
