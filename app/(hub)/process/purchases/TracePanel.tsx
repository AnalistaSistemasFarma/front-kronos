'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Loader, Stack, Text, Timeline } from '@mantine/core';
import { stateLabel } from '../../../../lib/purchases/fields';

/**
 * Trazabilidad de una solicitud de compra: borrador -> solicitud en firme ->
 * orden de compra -> factura (como el «Estado» de SAPSEND). Solo lectura.
 */

interface Step {
  firmDocNum: number | null;
  firmDate: string | null;
  orderDocNum: number | null;
  orderDate: string | null;
  invoiceDocNum: number | null;
  invoiceDate: string | null;
}

interface Trace {
  draftDocEntry: number;
  state: string | null;
  createdAt: string | null;
  firmDocEntry: number | null;
  steps: Step[];
  warning?: string;
}

const day = (v: string | null) => (v ? String(v).slice(0, 10) : '');

export default function TracePanel({ companyId, docEntry }: { companyId: number; docEntry: number }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrace(null);
    setError(null);
    fetch(`/api/purchases/trace?companyId=${companyId}&docEntry=${docEntry}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo consultar la trazabilidad');
        if (!cancelled) setTrace(data as Trace);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, docEntry]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!trace) return <Loader size="sm" />;

  const step = trace.steps[0];
  const reached = !trace.firmDocEntry ? 0 : step?.invoiceDocNum ? 3 : step?.orderDocNum ? 2 : 1;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Trazabilidad
      </Text>
      {trace.warning && <Alert color="yellow">{trace.warning}</Alert>}
      <Timeline active={reached} bulletSize={18} lineWidth={2}>
        <Timeline.Item title={`Borrador #${trace.draftDocEntry}`}>
          <Text size="xs" c="dimmed">
            {stateLabel(trace.state)} {day(trace.createdAt) && `· ${day(trace.createdAt)}`}
          </Text>
        </Timeline.Item>
        <Timeline.Item title="Solicitud en firme">
          <Text size="xs" c="dimmed">
            {trace.firmDocEntry
              ? `No. ${step?.firmDocNum ?? trace.firmDocEntry}${step?.firmDate ? ` · ${day(step.firmDate)}` : ''}`
              : 'Pendiente de aprobacion'}
          </Text>
        </Timeline.Item>
        <Timeline.Item title="Orden de compra">
          <Text size="xs" c="dimmed">
            {trace.steps.filter((s) => s.orderDocNum).map((s) => `No. ${s.orderDocNum} · ${day(s.orderDate)}`).join(' | ') ||
              'Sin orden'}
          </Text>
        </Timeline.Item>
        <Timeline.Item title="Factura">
          <Text size="xs" c="dimmed">
            {trace.steps
              .filter((s) => s.invoiceDocNum)
              .map((s) => `No. ${s.invoiceDocNum} · ${day(s.invoiceDate)}`)
              .join(' | ') || 'Sin factura'}
          </Text>
        </Timeline.Item>
      </Timeline>
    </Stack>
  );
}
