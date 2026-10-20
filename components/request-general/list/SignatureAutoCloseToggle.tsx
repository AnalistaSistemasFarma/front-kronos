'use client';

import { useEffect, useState } from 'react';
import { Switch, Tooltip } from '@mantine/core';

/**
 * Interruptor "Cerrar al firmar": si está activo, cuando todos los documentos de una
 * solicitud propia quedan firmados se cierran la tarea de firma y la solicitud
 * (solo si no queda otra tarea abierta). Por defecto desactivado.
 */
export function SignatureAutoCloseToggle() {
  const [enabled, setEnabled] = useState(false);
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
        setEnabled(Boolean(data.enabled));
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
    ? 'El cierre automático al firmar aún no está disponible.'
    : 'Si lo activas, cuando todos terminen de firmar el documento se cierra la tarea de firma y la solicitud (si no queda ninguna otra tarea abierta).';

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
