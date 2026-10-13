'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, NumberInput, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconArrowDown, IconArrowUp, IconCheck, IconPlus } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_ICONOS, OT_LIMITS } from '../../lib/bitacora-proceso/constants';
import SgcSelect from '../sgc/SgcSelect';
import { OtIconoActividad } from './otIconos';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { otSend, useOtFetch } from './otClient';

/**
 * Catálogo de actividades (pantalla 4, solo Gestión). Celular primero: una
 * tarjeta por actividad con interruptores grandes (Activa, Exige observación) y
 * flechas para ordenar. Las actividades NO se borran: se desactivan (el
 * historial de registros conserva su nombre).
 */
interface Actividad {
  id_actividad: number;
  nombre: string;
  exige_observacion: boolean;
  orden: number;
  activo: boolean;
  icono: string | null;
}

const ICONOS_DATA = Object.entries(OT_ICONOS).map(([value, label]) => ({ value, label }));

export default function OtCatalogo({ company }: { company: OtCompanyAccess }) {
  const { data, error, loading, reload } = useOtFetch<{ actividades: Actividad[] }>(`/api/bitacora-proceso/actividades?company=${company.idCompany}&todas=1`);
  const [nombre, setNombre] = useState('');
  const [exige, setExige] = useState(false);
  const [orden, setOrden] = useState<number | string>('');
  const [icono, setIcono] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'nueva' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lista = data?.actividades ?? [];

  const agregar = async () => {
    setBusy('nueva');
    setMsg(null);
    try {
      const siguiente = orden === '' ? (lista.length ? Math.max(...lista.map((a) => a.orden)) + 10 : 10) : Number(orden);
      await otSend('/api/bitacora-proceso/actividades', 'POST', { company: company.idCompany, nombre, exige_observacion: exige, orden: siguiente, icono });
      const text = `Actividad «${nombre.trim()}» agregada.`;
      setMsg({ ok: true, text });
      toast.success(text);
      setNombre('');
      setExige(false);
      setOrden('');
      setIcono(null);
      await reload(true);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const cambiar = async (a: Actividad, cambio: Partial<Pick<Actividad, 'activo' | 'exige_observacion' | 'orden' | 'icono'>>, text: string) => {
    setBusy(a.id_actividad);
    setMsg(null);
    try {
      await otSend('/api/bitacora-proceso/actividades', 'PATCH', { company: company.idCompany, id_actividad: a.id_actividad, ...cambio });
      setMsg({ ok: true, text });
      await reload(true);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  /** Intercambia el orden con la vecina (sube/baja un puesto). */
  const mover = async (i: number, dir: -1 | 1) => {
    const a = lista[i];
    const b = lista[i + dir];
    if (!a || !b) return;
    const oa = a.orden === b.orden ? a.orden + dir : b.orden;
    const ob = a.orden === b.orden ? b.orden : a.orden;
    await cambiar(a, { orden: oa }, `«${a.nombre}» movida.`);
    await cambiar(b, { orden: ob }, `«${a.nombre}» movida.`);
  };

  return (
    <Stack gap='md'>
      {msg && (
        <Alert color={msg.ok ? 'green' : 'red'} icon={msg.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />} withCloseButton onClose={() => setMsg(null)} data-testid='ot-catalogo-aviso'>
          {msg.text}
        </Alert>
      )}
      {error && <Alert color='red'>{error}</Alert>}

      <Card withBorder radius='md' p={{ base: 'md', sm: 'lg' }}>
        <Title order={2} size='h4' mb='sm'>Agregar actividad</Title>
        <Stack gap='sm'>
          <TextInput size='md' label='Nombre' maxLength={OT_LIMITS.actividadNombre} value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} data-testid='ot-catalogo-nombre' />
          <Group grow wrap='wrap' align='flex-end'>
            <NumberInput size='md' label='Orden' description='Vacío = al final' min={0} max={100000} value={orden} onChange={setOrden} miw={140} />
            <Switch size='lg' label='Exige observación' checked={exige} onChange={(e) => setExige(e.currentTarget.checked)} />
          </Group>
          <SgcSelect
            size='md'
            label='Ícono (opcional)'
            placeholder='Sin ícono'
            data={ICONOS_DATA}
            value={icono}
            onChange={setIcono}
            clearable
            leftSection={<OtIconoActividad icono={icono} size={20} />}
            data-testid='ot-catalogo-icono'
          />
          <Button size='lg' leftSection={<IconPlus size={20} />} onClick={agregar} loading={busy === 'nueva'} disabled={!nombre.trim()} fullWidth data-testid='ot-catalogo-agregar'>
            Agregar al catálogo
          </Button>
        </Stack>
      </Card>

      <Title order={2} size='h4'>
        Actividades <Badge variant='light' ml={4}>{lista.length}</Badge>
      </Title>
      <Text size='sm' c='dimmed'>
        Las actividades no se borran: desactive las que ya no se usan. El orden define la posición de los botones en la pantalla de planta. Los íconos son de una lista fija; más adelante se podrán cargar pictogramas propios.
      </Text>
      {loading && !data ? (
        <Loader />
      ) : (
        <Stack gap='sm' data-testid='ot-catalogo-lista'>
          {lista.map((a, i) => (
            <Card key={a.id_actividad} withBorder radius='md' p='md' opacity={a.activo ? 1 : 0.65}>
              <Group justify='space-between' wrap='nowrap' align='flex-start' gap='xs'>
                <div style={{ minWidth: 0 }}>
                  <Group gap='xs' wrap='nowrap' align='center'>
                    <OtIconoActividad icono={a.icono} size={26} />
                    <Text fw={600} size='lg' style={{ overflowWrap: 'anywhere' }}>{a.nombre}</Text>
                  </Group>
                  <Group gap={6} mt={4}>
                    <Badge variant='light' color={a.activo ? 'green' : 'gray'}>{a.activo ? 'Activa' : 'Inactiva'}</Badge>
                    {a.exige_observacion && <Badge variant='light' color='orange'>Exige observación</Badge>}
                    <Badge variant='outline' color='gray'>Orden {a.orden}</Badge>
                  </Group>
                </div>
                <Group gap={6} wrap='nowrap'>
                  <Button variant='default' size='lg' px='sm' aria-label='Subir' disabled={i === 0 || busy !== null} onClick={() => mover(i, -1)}>
                    <IconArrowUp size={20} />
                  </Button>
                  <Button variant='default' size='lg' px='sm' aria-label='Bajar' disabled={i === lista.length - 1 || busy !== null} onClick={() => mover(i, 1)}>
                    <IconArrowDown size={20} />
                  </Button>
                </Group>
              </Group>
              <Group mt='sm' gap='lg' wrap='wrap'>
                <Switch
                  size='lg'
                  label='Activa'
                  checked={a.activo}
                  disabled={busy !== null}
                  onChange={(e) => cambiar(a, { activo: e.currentTarget.checked }, `«${a.nombre}» ${e.currentTarget.checked ? 'activada' : 'desactivada'}.`)}
                />
                <Switch
                  size='lg'
                  label='Exige observación'
                  checked={a.exige_observacion}
                  disabled={busy !== null}
                  onChange={(e) => cambiar(a, { exige_observacion: e.currentTarget.checked }, `«${a.nombre}» actualizada.`)}
                />
              </Group>
              <SgcSelect
                mt='sm'
                size='md'
                label='Ícono'
                placeholder='Sin ícono'
                data={ICONOS_DATA}
                value={a.icono}
                onChange={(v) => cambiar(a, { icono: v }, `Ícono de «${a.nombre}» actualizado.`)}
                clearable
                disabled={busy !== null}
                leftSection={<OtIconoActividad icono={a.icono} size={20} />}
                w={{ base: '100%', sm: 320 }}
              />
            </Card>
          ))}
          {lista.length === 0 && <Text c='dimmed'>El catálogo está vacío.</Text>}
        </Stack>
      )}
    </Stack>
  );
}
