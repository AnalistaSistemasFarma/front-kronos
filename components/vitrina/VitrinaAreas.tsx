'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, NumberInput, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { VITRINA_LIMITS } from '../../lib/vitrina/constants';
import type { Area, CompanyAccess } from './types';
import { errorTexto, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/** Áreas asistenciales: lista cerrada común a las empresas. No se borran: se desactivan. */
export default function VitrinaAreas({ company, version, avisar }: { company: CompanyAccess; version: number; avisar: Avisar }) {
  const { data, error, loading, reload } = useVitrinaFetch<{ areas: Area[] }>(`/api/vitrina/gestion/areas?company=${company.idCompany}&v=${version}`);
  const [nombre, setNombre] = useState('');
  const [orden, setOrden] = useState<number | string>('');
  const [busy, setBusy] = useState<number | 'nueva' | null>(null);
  const lista = data?.areas ?? [];

  const agregar = async () => {
    setBusy('nueva');
    try {
      const siguiente = orden === '' ? (lista.length ? Math.max(...lista.map((a) => a.orden)) + 10 : 10) : Number(orden);
      await vitrinaSend('/api/vitrina/gestion/areas', 'POST', { company: company.idCompany, nombre, orden: siguiente });
      avisar(true, `Área «${nombre.trim()}» agregada.`);
      setNombre('');
      setOrden('');
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  const activar = async (a: Area, activa: boolean) => {
    setBusy(a.id);
    try {
      await vitrinaSend(`/api/vitrina/gestion/areas/${a.id}`, 'PATCH', { company: company.idCompany, activa });
      avisar(true, activa ? `Área «${a.nombre}» activada.` : `Área «${a.nombre}» desactivada.`);
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md'>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <Text fw={600} mb='xs'>
          Agregar área
        </Text>
        <Group grow wrap='wrap' gap='sm' align='flex-end'>
          <TextInput label='Nombre' size='md' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={VITRINA_LIMITS.areaNombre} miw={200} />
          <NumberInput label='Orden' size='md' min={0} max={10000} allowDecimal={false} value={orden} onChange={setOrden} miw={120} />
          <Button size='md' leftSection={<IconPlus size={18} />} onClick={agregar} loading={busy === 'nueva'} disabled={!nombre.trim()}>
            Agregar
          </Button>
        </Group>
      </Card>
      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : (
        <Stack gap='xs'>
          {lista.map((a) => (
            <Card key={a.id} withBorder radius='md' p='sm'>
              <Group justify='space-between' wrap='nowrap'>
                <div>
                  <Text fw={600} c={a.activa ? undefined : 'dimmed'}>
                    {a.nombre}
                  </Text>
                  <Group gap={6}>
                    <Badge variant='outline' color='gray' size='sm'>Orden {a.orden}</Badge>
                    <Badge variant='light' size='sm'>{a.presentaciones} presentación(es)</Badge>
                  </Group>
                </div>
                <Switch label='Activa' checked={a.activa} disabled={busy === a.id} onChange={(e) => activar(a, e.currentTarget.checked)} size='md' />
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
