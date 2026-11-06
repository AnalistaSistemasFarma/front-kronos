'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { ACCION_LABEL, ENTIDAD_LABEL, VITRINA_ENTIDADES, type VitrinaAccion, type VitrinaEntidad } from '../../lib/vitrina/constants';
import type { CompanyAccess, HistorialItem } from './types';
import { errorTexto, fmtFechaHora, useVitrinaFetch } from './vitrinaClient';

/** Historial de solo lectura: quién, cuándo, qué acción y los valores anterior y nuevo. */
const COLOR: Partial<Record<VitrinaAccion, string>> = {
  ACTIVAR: 'green',
  VALIDAR: 'green',
  DESACTIVAR: 'gray',
  RETIRAR: 'red',
  ELIMINAR: 'red',
  ALERTA_SAP: 'red',
  REGISTRO: 'yellow',
  SINCRONIZAR: 'blue',
};

function valores(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  return Object.entries(v as Record<string, unknown>)
    .filter(([k]) => k !== 'texto')
    .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x === null ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
    .join(' · ');
}

function textoDe(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { texto?: unknown }).texto === 'string' ? (v as { texto: string }).texto : null;
}

export default function VitrinaHistorial({ company, version }: { company: CompanyAccess; version: number }) {
  const [entidad, setEntidad] = useState<string | null>(null);
  const url = `/api/vitrina/gestion/historial?company=${company.idCompany}&v=${version}${entidad ? `&entidad=${entidad}` : ''}`;
  const { data, error, loading } = useVitrinaFetch<{ items: HistorialItem[]; siguiente: string | null }>(url);
  const [extra, setExtra] = useState<HistorialItem[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errMas, setErrMas] = useState<string | null>(null);

  useEffect(() => {
    setExtra([]);
    setSiguiente(data?.siguiente ?? null);
  }, [data]);

  const mas = async () => {
    if (!siguiente) return;
    setCargando(true);
    setErrMas(null);
    try {
      const res = await fetch(`${url}&antes=${siguiente}`, { cache: 'no-store' });
      const body = (await res.json()) as { items: HistorialItem[]; siguiente: string | null; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setExtra((x) => [...x, ...body.items]);
      setSiguiente(body.siguiente);
    } catch (e) {
      setErrMas(errorTexto(e));
    } finally {
      setCargando(false);
    }
  };

  const items = [...(data?.items ?? []), ...extra];

  return (
    <Stack gap='md'>
      {(error || errMas) && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error ?? errMas}
        </Alert>
      )}
      <SgcSelect
        size='md'
        placeholder='Todo el historial'
        data={VITRINA_ENTIDADES.map((e) => ({ value: e, label: ENTIDAD_LABEL[e] }))}
        value={entidad}
        onChange={setEntidad}
        clearable
        w={{ base: '100%', sm: 260 }}
      />
      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : items.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>Sin movimientos todavía.</Text>
        </Card>
      ) : (
        <Stack gap='xs' data-testid='vitrina-historial'>
          {items.map((h) => (
            <Card key={h.id} withBorder radius='md' p='sm'>
              <Group justify='space-between' wrap='wrap' gap={6}>
                <Group gap={6} wrap='wrap'>
                  <Badge variant='light' color={COLOR[h.accion as VitrinaAccion] ?? 'gray'} size='sm'>
                    {ACCION_LABEL[h.accion as VitrinaAccion] ?? h.accion}
                  </Badge>
                  <Text size='sm' fw={500}>
                    {ENTIDAD_LABEL[h.entidad as VitrinaEntidad] ?? h.entidad} #{h.idEntidad}
                  </Text>
                </Group>
                <Text size='xs' c='dimmed'>
                  {fmtFechaHora(h.registradoEn)} · {h.usuario}
                </Text>
              </Group>
              {textoDe(h.nuevo) && (
                <Text size='sm' mt={4}>
                  {textoDe(h.nuevo)}
                </Text>
              )}
              {Boolean(h.anterior) && (
                <Text size='xs' c='dimmed' mt={4}>
                  Antes: {valores(h.anterior)}
                </Text>
              )}
              {Boolean(h.nuevo) && (
                <Text size='xs' mt={2} lineClamp={4}>
                  Ahora: {valores(h.nuevo)}
                </Text>
              )}
            </Card>
          ))}
          {siguiente && (
            <Button variant='default' onClick={mas} loading={cargando}>
              Ver más
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
