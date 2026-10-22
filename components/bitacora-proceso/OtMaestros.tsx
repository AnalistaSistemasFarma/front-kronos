'use client';

import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, NumberInput, Radio, ScrollArea, SegmentedControl, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconDeviceFloppy, IconPencil, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_LIMITS, OT_RESPONSABLE_AYUDA, OT_RESPONSABLE_ROLES, OT_ROL_LABEL, type OtResponsableRol } from '../../lib/bitacora-proceso/constants';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { otSend, useOtFetch } from './otClient';
import { OtImportarOperadores } from './OtImportarYPin';

/**
 * Maestros de la bitácora (solo Gestión), reunión con Farmalógica del 2026-10-14:
 *   - OtOperadores (A1): operarios SIN usuario de SynerLink. El supervisor los
 *     crea, corrige el nombre o el documento y los desactiva. No se borran: los
 *     registros conservan el nombre con el que se hicieron.
 *   - OtAreas (A5): áreas predefinidas de la empresa (hoy «Envase y agrafado»).
 *   - OtResponsables (2026-10-16): quién es supervisor, inspector o jefe de producción en
 *     la empresa. Los selectores de la bitácora listan SOLO a estas personas.
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

interface Responsable {
  idResponsable: number;
  idUser: string;
  rol: OtResponsableRol;
  activo: boolean;
  name: string;
  email: string;
  habilitado: boolean;
}

interface Candidato {
  id: string;
  name: string;
  email: string;
  gestion: boolean;
}

const ROLES_DATA = OT_RESPONSABLE_ROLES.map((r) => ({ value: r, label: OT_ROL_LABEL[r] }));

/**
 * Responsables (2026-10-16): asignación por empresa de supervisor, inspector y jefe de
 * producción. Mismo aspecto que Operarios: tarjeta «Asignar» arriba y una tarjeta por
 * asignación con el interruptor «Activo». No se borran: se desactivan.
 */
export function OtResponsables({ company }: { company: OtCompanyAccess }) {
  const { data, error, loading, reload } = useOtFetch<{ responsables: Responsable[]; candidatos: Candidato[] }>(`/api/bitacora-proceso/responsables?company=${company.idCompany}`);
  const [rol, setRol] = useState<OtResponsableRol>('SUPERVISOR');
  const [persona, setPersona] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [busy, setBusy] = useState<number | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const lista = useMemo(() => data?.responsables ?? [], [data]);

  const candidatos = useMemo(() => {
    const yaTienen = new Set(lista.filter((r) => r.rol === rol && r.activo).map((r) => r.idUser));
    const f = filtro.trim().toLowerCase();
    return (data?.candidatos ?? [])
      .filter((c) => !yaTienen.has(c.id))
      .filter((c) => !f || c.name.toLowerCase().includes(f) || c.email.toLowerCase().includes(f));
  }, [data, lista, rol, filtro]);

  const ok = async (text: string) => {
    setAviso({ ok: true, text });
    toast.success(text);
    await reload(true);
  };

  const asignar = async () => {
    if (!persona) return;
    setBusy('nuevo');
    setAviso(null);
    try {
      const nombre = data?.candidatos.find((c) => c.id === persona)?.name ?? '';
      await otSend('/api/bitacora-proceso/responsables', 'POST', { company: company.idCompany, id_user: persona, rol });
      setPersona(null);
      setFiltro('');
      await ok(`«${nombre}» asignado como ${OT_ROL_LABEL[rol].toLowerCase()}.`);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const cambiar = async (r: Responsable, activo: boolean) => {
    setBusy(r.idResponsable);
    setAviso(null);
    try {
      await otSend('/api/bitacora-proceso/responsables', 'PATCH', { company: company.idCompany, id_responsable: r.idResponsable, activo });
      await ok(`«${r.name}» (${OT_ROL_LABEL[r.rol].toLowerCase()}) ${activo ? 'activado' : 'desactivado'}.`);
    } catch (e) {
      setAviso({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md'>
      <AvisoArriba aviso={aviso} onClose={() => setAviso(null)} testId='ot-responsables-aviso' />
      {error && <Alert color='red'>{error}</Alert>}

      <Card withBorder radius='md' p={{ base: 'md', sm: 'lg' }}>
        <Title order={2} size='h4' mb='sm'>Asignar responsable</Title>
        <Stack gap='sm'>
          <SegmentedControl fullWidth size='md' data={ROLES_DATA} value={rol} onChange={(v) => { setRol(v as OtResponsableRol); setPersona(null); }} data-testid='ot-responsable-rol' />
          <Text size='sm' c='dimmed'>{OT_RESPONSABLE_AYUDA[rol]}</Text>
          <TextInput size='md' placeholder='Buscar persona' leftSection={<IconSearch size={18} />} value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} data-testid='ot-responsable-buscar' />
          {loading && !data ? (
            <Loader size='sm' />
          ) : (
            <ScrollArea.Autosize mah={240} type='auto' offsetScrollbars>
              <Radio.Group value={persona} onChange={setPersona}>
                <Stack gap={6} data-testid='ot-responsable-candidatos'>
                  {candidatos.map((c) => {
                    const sinGestion = rol === 'SUPERVISOR' && !c.gestion;
                    return (
                      <Radio.Card key={c.id} value={c.id} radius='md' p='sm' withBorder disabled={sinGestion} opacity={sinGestion ? 0.55 : 1}>
                        <Group wrap='nowrap' gap='sm' mih={40}>
                          <Radio.Indicator size='md' disabled={sinGestion} />
                          <div style={{ minWidth: 0 }}>
                            <Text fw={500} truncate>{c.name}</Text>
                            <Text size='xs' c='dimmed' truncate>{sinGestion ? 'Sin permiso de Gestión: no puede ser supervisor' : c.email}</Text>
                          </div>
                        </Group>
                      </Radio.Card>
                    );
                  })}
                  {candidatos.length === 0 && <Text size='sm' c='dimmed'>No hay más personas con el permiso del módulo en esta empresa.</Text>}
                </Stack>
              </Radio.Group>
            </ScrollArea.Autosize>
          )}
          <Button size='lg' leftSection={<IconPlus size={20} />} onClick={asignar} loading={busy === 'nuevo'} disabled={!persona} fullWidth data-testid='ot-responsable-asignar'>
            Asignar como {OT_ROL_LABEL[rol].toLowerCase()}
          </Button>
        </Stack>
      </Card>

      <Title order={2} size='h4'>
        Responsables <Badge variant='light' ml={4}>{lista.filter((r) => r.activo).length} activos</Badge>
      </Title>
      <Text size='sm' c='dimmed'>
        Al abrir y cerrar la bitácora solo se pueden elegir las personas asignadas aquí. En una misma bitácora el inspector es distinto de quien abre y del jefe de producción; el jefe puede abrir y cerrar su propia bitácora. No se borran: desactive a quien ya no cumple el rol.
      </Text>
      {loading && !data ? (
        <Loader />
      ) : (
        <Stack gap='sm' data-testid='ot-responsables-lista'>
          {OT_RESPONSABLE_ROLES.map((r) => {
            const delRol = lista.filter((x) => x.rol === r);
            return (
              <Stack key={r} gap='xs' data-testid={`ot-responsables-${r}`}>
                <Text fw={600} size='md'>
                  {OT_ROL_LABEL[r]} <Badge variant='light' ml={4}>{delRol.filter((x) => x.activo).length}</Badge>
                </Text>
                {delRol.map((x) => (
                  <Card key={x.idResponsable} withBorder radius='md' p='md' opacity={x.activo ? 1 : 0.65}>
                    <Group justify='space-between' wrap='wrap' gap='sm'>
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} size='lg' style={{ overflowWrap: 'anywhere' }}>{x.name}</Text>
                        <Group gap={6} mt={4}>
                          <Badge variant='light' color={x.activo ? 'green' : 'gray'}>{x.activo ? 'Activo' : 'Inactivo'}</Badge>
                          {x.activo && !x.habilitado && (
                            <Badge variant='light' color='orange'>{x.rol === 'SUPERVISOR' ? 'Sin permiso de Gestión' : 'Sin permiso del módulo'}</Badge>
                          )}
                          {x.email && <Badge variant='outline' color='gray' style={{ textTransform: 'none' }}>{x.email}</Badge>}
                        </Group>
                      </div>
                      <Switch size='lg' label='Activo' checked={x.activo} disabled={busy !== null} onChange={(e) => cambiar(x, e.currentTarget.checked)} />
                    </Group>
                  </Card>
                ))}
                {delRol.length === 0 && <Text size='sm' c='dimmed'>Nadie asignado.</Text>}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
