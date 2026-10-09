'use client';

import { useEffect, useState } from 'react';
import { Switch, Tooltip } from '@mantine/core';
import toast from 'react-hot-toast';

/**
 * «Recibir alertas»: cada persona decide si le llegan las alertas tempranas por campana y push.
 * Apagado por defecto. Las alertas se siguen viendo en esta página aunque esté apagado.
 */
export function AlertSubscriptionSwitch() {
  const [subscribed, setSubscribed] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/system-metrics/alert-subscription', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { subscribed?: boolean; tableMissing?: boolean }) => {
        if (cancelled) return;
        setSubscribed(Boolean(data.subscribed));
        setTableMissing(Boolean(data.tableMissing));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setSubscribed(enabled);
    try {
      const res = await fetch('/api/system-metrics/alert-subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; tableMissing?: boolean };
      if (!res.ok) {
        if (data.tableMissing) setTableMissing(true);
        throw new Error(data.error || 'No se pudo guardar');
      }
      toast.success(enabled ? 'Recibirás las alertas por campana y push' : 'Ya no recibirás alertas del monitor');
    } catch (err) {
      setSubscribed(!enabled);
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const label = tableMissing ? 'Recibir alertas (falta la tabla)' : 'Recibir alertas';
  return (
    <Tooltip
      label={
        tableMissing
          ? 'Hay que correr prisma/manual/2026-10-09-system-metrics-alertas-suscriptores.sql en esta base'
          : 'Te llegan por la campana y push. Apagado, las alertas solo se ven aquí.'
      }
      multiline
      w={280}
      withinPortal
    >
      <span>
        <Switch
          size="sm"
          label={label}
          checked={subscribed}
          disabled={loading || saving || tableMissing}
          onChange={(e) => void toggle(e.currentTarget.checked)}
        />
      </span>
    </Tooltip>
  );
}
