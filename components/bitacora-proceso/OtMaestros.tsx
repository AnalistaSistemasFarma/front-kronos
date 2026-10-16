'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, NumberInput, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconDeviceFloppy, IconPencil, IconPlus, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_LIMITS } from '../../lib/bitacora-proceso/constants';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { otSend, useOtFetch } from './otClient';
import { OtImportarOperadores } from './OtImportarYPin';

/**
 * Maestros de la bitácora (solo Gestión), reunión con Farmalógica del 2026-10-14:
 *   - OtOperadores (A1): operarios SIN usuario de SynerLink. El supervisor los
 *     crea, corrige el nombre o el documento y los desactiva. No se borran: los
 *     registros conservan el nombre con el que se hicieron.
 *   - OtAreas (A5): áreas predefinidas de la empresa (hoy «Envase y agrafado»).
 * Celular primero: tarjetas, campos de 16 px e interruptores grandes; el aviso
 * del resultado aparece arriba y en color.
 */
type Aviso = { ok: boolean; text: string } | null;

function AvisoArriba({ aviso, onClose, testId }: { aviso: Aviso; onClose: () => void; testId: string }) {
  if (!aviso) return null;
  return (
    <Alert color={aviso.ok ? 'green' : 'red'} icon={aviso.ok ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />} withCloseButton onClose={onClose} data-testid={testId}>
      {aviso.text}
    </Alert>
  );
}

interface Operador {
  id_operador: number;
  nombre: string;
  documento: string | null;
  activo: boolean;
}

export function OtOperadores({ company }: { company: OtCompanyAccess }) {
  const { data, error, loading, reload } = useOtFetch<{ operadores: Operador[] }>(`/api/bitacora-proceso/operadores?company=${company.idCompany}&todas=1`);
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [busy, setBusy] = useState<number | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [editando, setEditando] = useState<{ id: number; nombre: string; documento: string } | null>(null);
  const lista = data?.operadores ?? [];

  const ok = async (text: string) => {
    setAviso({ ok: true, text });
    toast.success(text);
    await reload(true);
  };

  const agregar = async () => {
    setBusy('nuevo');
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/operadores', 'POST', { company: company.idCompany, nombre, documento: documento || undefined });
      await ok(`Operario «${nombre.trim()}» agregado.`);
      setNombre('');
      setDocumento('');
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const cambiar = async (id: number, cambio: Record<string, unknown>, text: string) => {
    setBusy(id);
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/operadores', 'PATCH', { company: company.idCompany, id_operador: id, ...cambio });
      setEditando(null);
      await ok(text);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md'>
      <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} testId='ot-operadores-aviso' />
      {error && <Alert color='red'>{error}</Alert>}

      <Card withBorder radius='md' p={{ base: 'md', sm: 'lg' }}>
        <Title order={2} size='h4' mb='sm'>Agregar operario</Title>
        <Stack gap='sm'>
          <TextInput size='md' label='Nombre completo' required maxLength={OT_LIMITS.operadorNombre} value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} data-testid='ot-operador-nombre' />
          <TextInput size='md' label='Documento (opcional)' maxLength={OT_LIMITS.operadorDocumento} value={documento} onChange={(e) => setDocumento(e.currentTarget.value)} data-testid='ot-operador-documento' />
          <Button size='lg' leftSection={<IconPlus size={20} />} onClick={agregar} loading={busy === 'nuevo'} disabled={!nombre.trim()} fullWidth data-testid='ot-operador-agregar'>
            Agregar operario
          </Button>
        </Stack>
      </Card>

      <Group justify='space-between' wrap='wrap' gap='sm'>
        <Title order={2} size='h4'>
          Operarios <Badge variant='light' ml={4}>{lista.filter((o) => o.activo).length} activos</Badge>
        </Title>
        <OtImportarOperadores company={company} onImportado={() => void reload(true)} />
      </Group>
      <Text size='sm' c='dimmed'>
        Los operarios no tienen usuario de SynerLink: el supervisor los programa al abrir la bitácora y en la tablet cada uno toca su nombre. No se borran: desactive a quien ya no trabaja en el área.
      </Text>
      {loading && !data ? (
        <Loader />
      ) : (
        <Stack gap='sm' data-testid='ot-operadores-lista'>
          {lista.map((o) => {
            const ed = editando?.id === o.id_operador ? editando : null;
            return (
              <Card key={o.id_operador} withBorder radius='md' p='md' opacity={o.activo ? 1 : 0.65}>
                {ed ? (
                  <Stack gap='sm'>
                    <TextInput size='md' label='Nombre completo' maxLength={OT_LIMITS.operadorNombre} value={ed.nombre} onChange={(e) => setEditando({ ...ed, nombre: e.currentTarget.value })} />
                    <TextInput size='md' label='Documento (opcional)' maxLength={OT_LIMITS.operadorDocumento} value={ed.documento} onChange={(e) => setEditando({ ...ed, documento: e.currentTarget.value })} />
                    <Group grow gap='sm'>
                      <Button variant='default' size='md' h={48} leftSection={<IconX size={18} />} onClick={() => setEditando(null)} disabled={busy !== null}>
                        Cancelar
                      </Button>
                      <Button
                        size='md'
                        h={48}
                        leftSection={<IconDeviceFloppy size={18} />}
                        loading={busy === o.id_operador}
                        disabled={!ed.nombre.trim()}
                        onClick={() => cambiar(o.id_operador, { nombre: ed.nombre, documento: ed.documento }, `Operario «${ed.nombre.trim()}» actualizado.`)}
                      >
                        Guardar
                      </Button>
                    </Group>
                  </Stack>
                ) : (
                  <Group justify='space-between' wrap='wrap' gap='sm'>
                    <div style={{ minWidth: 0 }}>
                      <Text fw={600} size='lg' style={{ overflowWrap: 'anywhere' }}>{o.nombre}</Text>
                      <Group gap={6} mt={4}>
                        <Badge variant='light' color={o.activo ? 'green' : 'gray'}>{o.activo ? 'Activo' : 'Inactivo'}</Badge>
                        {o.documento && <Badge variant='outline' color='gray'>Doc. {o.documento}</Badge>}
                      </Group>
                    </div>
                    <Group gap='md' wrap='nowrap'>
                      <Button variant='default' size='md' leftSection={<IconPencil size={18} />} disabled={busy !== null} onClick={() => setEditando({ id: o.id_operador, nombre: o.nombre, documento: o.documento ?? '' })}>
                        Editar
                      </Button>
                      <Switch
                        size='lg'
                        label='Activo'
                        checked={o.activo}
                        disabled={busy !== null}
                        onChange={(e) => cambiar(o.id_operador, { activo: e.currentTarget.checked }, `«${o.nombre}» ${e.currentTarget.checked ? 'activado' : 'desactivado'}.`)}
                      />
                    </Group>
                  </Group>
                )}
              </Card>
            );
          })}
          {lista.length === 0 && <Text c='dimmed'>Aún no hay operarios. Agregue los que trabajan en el área.</Text>}
        </Stack>
      )}
    </Stack>
  );
}

interface Area {
  id_area: number;
  nombre: string;
  orden: number;
  activo: boolean;
}

export function OtAreas({ company }: { company: OtCompanyAccess }) {
  const { data, error, loading, reload } = useOtFetch<{ areas: Area[] }>(`/api/bitacora-proceso/areas?company=${company.idCompany}&todas=1`);
  const [nombre, setNombre] = useState('');
  const [orden, setOrden] = useState<number | string>('');
  const [busy, setBusy] = useState<number | 'nueva' | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const lista = data?.areas ?? [];

  const agregar = async () => {
    setBusy('nueva');
    setAviso(null);
    try {
      const siguiente = orden === '' ? (lista.length ? Math.max(...lista.map((a) => a.orden)) + 10 : 10) : Number(orden);
      await otSend('/api/bitacora-proceso/areas', 'POST', { company: company.idCompany, nombre, orden: siguiente });
      const text = `Área «${nombre.trim()}» agregada.`;
      setAviso({ ok: true, text });
      toast.success(text);
      setNombre('');
      setOrden('');
      await reload(true);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const cambiar = async (a: Area, activo: boolean) => {
    setBusy(a.id_area);
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/areas', 'PATCH', { company: company.idCompany, id_area: a.id_area, activo });
      setAviso({ ok: true, text: `«${a.nombre}» ${activo ? 'activada' : 'desactivada'}.` });
      await reload(true);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md'>
      <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} testId='ot-areas-aviso' />
      {error && <Alert color='red'>{error}</Alert>}
      <Card withBorder radius='md' p={{ base: 'md', sm: 'lg' }}>
        <Title order={2} size='h4' mb='sm'>Agregar área</Title>
        <Stack gap='sm'>
          <TextInput size='md' label='Nombre' maxLength={OT_LIMITS.areaNombre} value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} data-testid='ot-area-nombre' />
          <NumberInput size='md' label='Orden' description='Vacío = al final' min={0} max={100000} value={orden} onChange={setOrden} w={{ base: '100%', sm: 220 }} />
          <Button size='lg' leftSection={<IconPlus size={20} />} onClick={agregar} loading={busy === 'nueva'} disabled={!nombre.trim()} fullWidth data-testid='ot-area-agregar'>
            Agregar área
          </Button>
        </Stack>
      </Card>
      <Title order={2} size='h4'>
        Áreas <Badge variant='light' ml={4}>{lista.length}</Badge>
      </Title>
      <Text size='sm' c='dimmed'>
        El supervisor elige el área al abrir la bitácora (no se escribe a mano). Si hay una sola área activa, viene seleccionada. Las áreas no se borran: se desactivan.
      </Text>
      {loading && !data ? (
        <Loader />
      ) : (
        <Stack gap='sm' data-testid='ot-areas-lista'>
          {lista.map((a) => (
            <Card key={a.id_area} withBorder radius='md' p='md' opacity={a.activo ? 1 : 0.65}>
              <Group justify='space-between' wrap='wrap' gap='sm'>
                <div>
                  <Text fw={600} size='lg'>{a.nombre}</Text>
                  <Group gap={6} mt={4}>
                    <Badge variant='light' color={a.activo ? 'green' : 'gray'}>{a.activo ? 'Activa' : 'Inactiva'}</Badge>
                    <Badge variant='outline' color='gray'>Orden {a.orden}</Badge>
                  </Group>
                </div>
                <Switch size='lg' label='Activa' checked={a.activo} disabled={busy !== null} onChange={(e) => cambiar(a, e.currentTarget.checked)} />
              </Group>
            </Card>
          ))}
          {lista.length === 0 && <Text c='dimmed'>Aún no hay áreas en el catálogo.</Text>}
        </Stack>
      )}
    </Stack>
  );
}
