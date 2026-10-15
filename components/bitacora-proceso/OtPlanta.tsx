'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconChevronRight,
  IconHandClick,
  IconLock,
  IconMessagePlus,
  IconPrinter,
  IconSquare,
  IconSquareCheck,
  IconUserCircle,
  IconUserPlus,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_BASE_URL, OT_FIRMA_SIGNIFICADO, OT_JEFE_PRODUCCION_LABEL, OT_LIMITS, OT_ROL_LABEL, otPictograma } from '../../lib/bitacora-proceso/constants';
import type { OrdenDetalle } from '../../lib/bitacora-proceso/db';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { OtIconoActividad } from './otIconos';
import ConfirmacionBitacoraModal, { type Confirmante } from './ConfirmacionBitacoraModal';
import { codigoOt, fmtFechaHora, fmtFechaHoraSeg, fmtHora, otHref, otSend, turnoLabel, useOtFetch } from './otClient';

/**
 * Pantalla de planta (tablet). Reunión con Farmalógica del 2026-10-14:
 *   - A2: registro de DOS TOQUES y sin teclado: 1) el operario toca SU NOMBRE
 *     (operarios programados por el supervisor, sin usuario de SynerLink);
 *     2) toca la ACTIVIDAD y queda registrada con la hora del servidor. La
 *     observación es opcional (botón aparte, antes de tocar la actividad).
 *   - Tras cada registro se vuelve al paso 1, para que el siguiente operario se
 *     identifique (la tablet la comparten varios).
 *   - A4: «Cerró» / «Verificó» con un check y la contraseña de quien confirma.
 * Celular/tablet primero: encabezado fijo, botones de 72-80 px (con guantes),
 * aviso del resultado arriba y en color. Los registros NO se editan ni se borran.
 */
interface Actividad {
  id_actividad: number;
  nombre: string;
  icono: string | null;
}

interface OperadorMaestro {
  id_operador: number;
  nombre: string;
}

type Confirmar = 'SUPERVISOR' | 'INSPECTOR' | null;

export default function OtPlanta({ company, idOrden }: { company: OtCompanyAccess; idOrden: number }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const detalle = useOtFetch<{ orden: OrdenDetalle }>(`/api/bitacora-proceso/${idOrden}?company=${company.idCompany}`, 20_000);
  const acts = useOtFetch<{ actividades: Actividad[] }>(`/api/bitacora-proceso/actividades?company=${company.idCompany}`);
  const [operador, setOperador] = useState<{ id: number; nombre: string } | null>(null);
  const [conObs, setConObs] = useState(false);
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmar>(null);
  const supervisores = useOtFetch<{ supervisores: Confirmante[] }>(confirmar === 'SUPERVISOR' ? `/api/bitacora-proceso/supervisores?company=${company.idCompany}` : null);
  const [agregar, setAgregar] = useState(false);

  const o = detalle.data?.orden;
  const conOperadores = (o?.operadores.length ?? 0) > 0;

  const arriba = () => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Segundo toque: registra la actividad para el operario elegido (o sin operario en bitácoras anteriores). */
  const registrar = async (a: Actividad) => {
    if (!o || busy !== null) return;
    if (conOperadores && !operador) return;
    setBusy(a.id_actividad);
    try {
      const r = await otSend<{ registro: { registradoEn: string; actividad: string; operador: string | null } }>(
        `/api/bitacora-proceso/${o.id}/registros?company=${company.idCompany}`,
        'POST',
        { id_actividad: a.id_actividad, id_operador: operador?.id, observacion: obs.trim() || undefined }
      );
      const quien = r.registro.operador ? ` — ${r.registro.operador}` : '';
      const text = `Registrado: ${r.registro.actividad}${quien} a las ${fmtHora(r.registro.registradoEn)}.`;
      setAviso({ ok: true, text });
      toast.success(text);
      setOperador(null);
      setObs('');
      setConObs(false);
      await detalle.reload(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAviso({ ok: false, text: `No se registró: ${msg}` });
      toast.error(msg);
      await detalle.reload(true);
    } finally {
      setBusy(null);
      arriba();
    }
  };

  /** Cierre («Cerró») o verificación («Verificó»). Lanza el error para que el modal lo muestre arriba. */
  const confirmarBitacora = async ({ firmante, password, observacion }: { firmante: string; password: string; observacion: string }) => {
    if (!o || !confirmar) return;
    const accion = confirmar === 'SUPERVISOR' ? 'cerrar' : 'verificar';
    const r = await otSend<{ firmante?: string }>(`/api/bitacora-proceso/${o.id}/${accion}?company=${company.idCompany}`, 'POST', {
      firmante,
      password,
      confirmo: true,
      ...(confirmar === 'SUPERVISOR' ? { observacion: observacion || undefined } : {}),
    });
    const text =
      confirmar === 'SUPERVISOR'
        ? `Bitácora ${codigoOt(o.consecutivo)} cerrada («Cerró»: ${r.firmante ?? ''}). Ya no admite registros; se avisó al jefe de producción para que la verifique.`
        : `Bitácora ${codigoOt(o.consecutivo)} verificada («Verificó»: ${r.firmante ?? ''}).`;
    setConfirmar(null);
    setAviso({ ok: true, text });
    toast.success(text);
    await detalle.reload(true);
    arriba();
  };

  const personasConfirman = useMemo<Confirmante[]>(() => {
    if (!o) return [];
    if (confirmar === 'INSPECTOR') return o.inspector ? [o.inspector] : [];
    // El jefe de producción de la bitácora no puede cerrarla (segregación).
    return (supervisores.data?.supervisores ?? []).filter((p) => p.id !== o.inspector?.id);
  }, [o, confirmar, supervisores.data]);

  if (detalle.loading && !o) {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }
  if (!o) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Bitácora de Proceso' data-testid='ot-detalle-error'>
        {detalle.error ?? 'No se encontró la bitácora.'}
      </Alert>
    );
  }

  const abierta = o.estado === 'ABIERTA';
  const firmaSup = o.firmas.find((f) => f.rol === 'SUPERVISOR');
  const firmaJefe = o.firmas.find((f) => f.rol === 'INSPECTOR');
  const estadoLabel = abierta ? 'Abierta' : firmaJefe ? 'Verificada' : 'Por verificar';
  const estadoColor = abierta ? 'green' : firmaJefe ? 'blue' : 'yellow';
  const registrosDesc = [...o.registros].reverse();
  const informeHref = otHref(`${OT_BASE_URL}/${o.id}/informe`, company.idCompany);
  const paso: 1 | 2 = conOperadores && !operador ? 1 : 2;

  return (
    <Stack gap='md' pb={mobile ? 88 : 0}>
      {/* Encabezado fijo: producto, lote, OP y turno siempre a la vista. */}
      <Card withBorder shadow='sm' radius='md' p={{ base: 'sm', sm: 'md' }} pos='sticky' top={0} style={{ zIndex: 20 }} data-testid='ot-encabezado'>
        <Group justify='space-between' wrap='nowrap' align='center' gap='xs' mb={6}>
          <Breadcrumbs separator={<IconChevronRight size={14} />} style={{ flexWrap: 'wrap', minWidth: 0 }}>
            {!mobile && (
              <Anchor component={Link} href='/process' size='sm'>
                Procesos
              </Anchor>
            )}
            <Anchor component={Link} href={otHref(OT_BASE_URL, company.idCompany)} size='sm'>
              Bitácora de Proceso
            </Anchor>
            <Text size='sm' fw={700}>{codigoOt(o.consecutivo)}</Text>
          </Breadcrumbs>
          <Badge color={estadoColor} variant='light' size='lg' style={{ flexShrink: 0 }} data-testid='ot-estado'>
            {estadoLabel}
          </Badge>
        </Group>
        <Title order={1} size='h3' lineClamp={2}>
          {o.producto}
        </Title>
        <Text size='md' mt={2}>
          Lote <b>{o.lote}</b> · Turno <b>{turnoLabel(o.turno)}</b>
          {o.sapOpDocNum ? <> · OP <b>{o.sapOpDocNum}</b></> : null}
        </Text>
        <Text size='sm' c='dimmed'>
          Inicio <b>{fmtHora(o.abiertaEn)}</b> · Final <b>{o.cerradaEn ? fmtHora(o.cerradaEn) : '—'}</b>
          {o.area ? ` · ${o.area}` : ''}
        </Text>
      </Card>

      {aviso && (
        <Alert
          color={aviso.ok ? 'green' : 'red'}
          icon={aviso.ok ? <IconCheck size={20} /> : <IconAlertTriangle size={20} />}
          withCloseButton
          onClose={() => setAviso(null)}
          styles={{ message: { fontSize: 'var(--mantine-font-size-md)' } }}
          data-testid='ot-aviso'
        >
          {aviso.text}
        </Alert>
      )}

      {!abierta && (
        <Alert color='gray' icon={<IconLock size={18} />} title='Bitácora cerrada' data-testid='ot-cerrada'>
          Cerrada el {fmtFechaHora(o.cerradaEn)} por {o.cerradaPor ?? '—'}. Ya no admite registros.
          {firmaJefe ? ` Verificada por ${firmaJefe.nombre}.` : ' Pendiente la verificación del jefe de producción.'}
          {o.observacionCierre ? ` Observación: ${o.observacionCierre}` : ''}
        </Alert>
      )}
      {abierta && !o.puedeRegistrar && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} data-testid='ot-no-operario'>
          Usted no figura como auxiliar ni como jefe de producción de esta bitácora: puede consultarla, pero no registrar. Pida al supervisor que lo incluya.
        </Alert>
      )}

      {/* PASO 1 — ¿Quién es usted? (solo bitácoras con operarios programados) */}
      {abierta && o.puedeRegistrar && paso === 1 && (
        <Box data-testid='ot-paso-operario'>
          <Group gap={6} mb='xs'>
            <IconUserCircle size={22} />
            <Text fw={700} size='lg'>1. Toque su nombre</Text>
          </Group>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing='sm' data-testid='ot-operadores'>
            {o.operadores.map((p) => (
              <Button
                key={p.id}
                size='xl'
                h={76}
                variant='default'
                fullWidth
                disabled={!p.activo}
                onClick={() => {
                  setAviso(null);
                  setOperador({ id: p.id, nombre: p.nombre });
                }}
                styles={{ label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }}
                data-testid='ot-operador'
              >
                {p.nombre}
              </Button>
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* PASO 2 — Actividad: un toque registra. */}
      {abierta && o.puedeRegistrar && paso === 2 && (
        <Box data-testid='ot-paso-actividad'>
          {operador && (
            <Paper withBorder radius='md' p='sm' mb='sm' bg='var(--mantine-color-blue-light)'>
              <Group justify='space-between' wrap='nowrap' gap='xs'>
                <Text size='lg' style={{ minWidth: 0 }}>
                  Registra: <b data-testid='ot-operador-elegido'>{operador.nombre}</b>
                </Text>
                <Button variant='default' size='md' h={48} leftSection={<IconArrowBackUp size={18} />} onClick={() => setOperador(null)} disabled={busy !== null} data-testid='ot-cambiar-operador'>
                  {mobile ? 'Cambiar' : 'No soy yo'}
                </Button>
              </Group>
            </Paper>
          )}
          <Group gap={6} mb='xs' justify='space-between' wrap='wrap'>
            <Group gap={6}>
              <IconHandClick size={20} />
              <Text fw={700} size='lg'>{conOperadores ? '2. Toque la actividad' : 'Toque la actividad que va a registrar'}</Text>
            </Group>
            <Button variant='subtle' size='md' leftSection={<IconMessagePlus size={18} />} onClick={() => setConObs((v) => !v)} data-testid='ot-obs-toggle'>
              {conObs ? 'Sin observación' : 'Agregar observación (opcional)'}
            </Button>
          </Group>
          <Collapse in={conObs}>
            <Textarea
              size='md'
              mb='sm'
              label='Observación (opcional): se guarda con la próxima actividad que toque'
              autosize
              minRows={2}
              maxRows={4}
              maxLength={OT_LIMITS.observacion}
              value={obs}
              onChange={(e) => setObs(e.currentTarget.value)}
              description={`${obs.length}/${OT_LIMITS.observacion}`}
              data-testid='ot-observacion'
            />
          </Collapse>
          {acts.error && <Alert color='red'>{acts.error}</Alert>}
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing='sm' data-testid='ot-actividades'>
            {(acts.data?.actividades ?? []).map((a) => (
              <Button
                key={a.id_actividad}
                size='xl'
                h={80}
                variant='light'
                fullWidth
                loading={busy === a.id_actividad}
                disabled={busy !== null && busy !== a.id_actividad}
                onClick={() => registrar(a)}
                leftSection={<OtIconoActividad icono={a.icono} size={otPictograma(a.icono) ? 52 : 30} />}
                styles={{ label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }}
                data-testid='ot-actividad'
              >
                {a.nombre}
              </Button>
            ))}
          </SimpleGrid>
          {acts.data && acts.data.actividades.length === 0 && (
            <Text c='dimmed'>No hay actividades activas en el catálogo. El supervisor debe agregarlas.</Text>
          )}
          <Text size='xs' c='dimmed' mt='xs'>
            Al tocar la actividad queda registrada con la hora del servidor. Después no se puede editar ni borrar.
          </Text>
        </Box>
      )}

      <Card withBorder radius='md' p={{ base: 'sm', sm: 'md' }}>
        <Group justify='space-between' mb='xs' wrap='wrap'>
          <Text fw={700} size='lg'>
            Cronología <Badge component='span' variant='light' ml={4}>{o.registros.length}</Badge>
          </Text>
          <Text size='xs' c='dimmed'>Hora del servidor (Colombia). Los registros no se editan ni se borran.</Text>
        </Group>
        {registrosDesc.length === 0 ? (
          <Text c='dimmed'>Aún no hay registros en esta bitácora.</Text>
        ) : (
          <Stack gap='xs' data-testid='ot-cronologia'>
            {registrosDesc.map((r) => (
              <Paper key={r.id} withBorder radius='md' p='sm' data-testid='ot-registro'>
                <Group justify='space-between' wrap='nowrap' align='flex-start' gap='xs'>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600}>{r.actividad}</Text>
                    <Text size='sm'>{r.operador ?? r.usuario}</Text>
                    {r.operador && <Text size='xs' c='dimmed'>Registró: {r.usuario}</Text>}
                    {r.observacion && <Text size='sm' mt={2} style={{ overflowWrap: 'anywhere' }}>{r.observacion}</Text>}
                  </div>
                  <Text fw={700} size='md' style={{ whiteSpace: 'nowrap' }}>{fmtHora(r.registradoEn)}</Text>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Card>

      {!abierta && (
        <Card withBorder radius='md' p={{ base: 'sm', sm: 'md' }} data-testid='ot-firmas'>
          <Text fw={700} size='lg' mb='xs'>Verificación</Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='sm'>
            {(['SUPERVISOR', 'INSPECTOR'] as const).map((rol) => {
              const f = rol === 'SUPERVISOR' ? firmaSup : firmaJefe;
              const Icono = f ? IconSquareCheck : IconSquare;
              return (
                <Paper key={rol} withBorder radius='md' p='sm' data-testid={`ot-firma-${rol.toLowerCase()}`}>
                  <Group gap={8} wrap='nowrap'>
                    <Icono size={24} />
                    <div>
                      <Text fw={700}>{OT_FIRMA_SIGNIFICADO[rol]}</Text>
                      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>{OT_ROL_LABEL[rol]}</Text>
                    </div>
                  </Group>
                  {f ? (
                    <>
                      <Text fw={600} mt={4}>{f.nombre}</Text>
                      <Text size='sm'>{fmtFechaHoraSeg(f.firmadoEn)}</Text>
                    </>
                  ) : (
                    <Text c='dimmed' mt={4}>Pendiente{rol === 'INSPECTOR' && o.inspector ? ` — ${o.inspector.name}` : ''}</Text>
                  )}
                </Paper>
              );
            })}
          </SimpleGrid>
        </Card>
      )}

      <Card withBorder radius='md' p={{ base: 'sm', sm: 'md' }}>
        <Group justify='space-between' mb='xs' wrap='wrap'>
          <Text fw={700} size='lg'>Encabezado</Text>
          {abierta && o.puedeGestionar && conOperadores && (
            <Button variant='light' size='md' leftSection={<IconUserPlus size={18} />} onClick={() => setAgregar(true)} data-testid='ot-agregar-operadores'>
              Agregar operarios
            </Button>
          )}
        </Group>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='sm' verticalSpacing='xs' data-testid='ot-encabezado-campos'>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Hora inicio</Text>
            <Text>{fmtFechaHora(o.abiertaEn)}</Text>
          </div>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Hora final</Text>
            <Text>{o.cerradaEn ? fmtFechaHora(o.cerradaEn) : 'Abierta'}</Text>
          </div>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Supervisor</Text>
            <Text>{o.abiertaPor}</Text>
          </div>
          <div>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600}>{OT_JEFE_PRODUCCION_LABEL}</Text>
            <Text>{o.inspector?.name ?? '—'}</Text>
          </div>
        </SimpleGrid>
        {o.operadores.length > 0 && (
          <>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600} mt='sm' mb={4}>Operarios</Text>
            <Group gap={6} wrap='wrap'>
              {o.operadores.map((p) => (
                <Badge key={p.id} variant='outline' size='lg' color={p.activo ? undefined : 'gray'} style={{ textTransform: 'none' }}>
                  {p.nombre}
                </Badge>
              ))}
            </Group>
          </>
        )}
        {o.operarios.length > 0 && (
          <>
            <Text size='xs' c='dimmed' tt='uppercase' fw={600} mt='sm' mb={4}>Auxiliares (con usuario)</Text>
            <Group gap={6} wrap='wrap'>
              {o.operarios.map((p) => (
                <Badge key={p.id} variant='outline' size='lg' style={{ textTransform: 'none' }}>
                  {p.name}
                </Badge>
              ))}
            </Group>
          </>
        )}
      </Card>

      {/* Acciones: fijas abajo en el celular; al final en escritorio. */}
      <Box
        pos={mobile ? 'fixed' : 'static'}
        bottom={0}
        left={0}
        right={0}
        p={mobile ? 'md' : 0}
        bg={mobile ? 'var(--mantine-color-body)' : undefined}
        style={mobile ? { borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 150 } : undefined}
      >
        <Group grow={mobile} justify='flex-end' gap='sm'>
          <Button variant='default' size={mobile ? 'md' : 'lg'} h={mobile ? 52 : undefined} leftSection={<IconPrinter size={18} />} component={Link} href={informeHref} data-testid='ot-informe'>
            {mobile ? 'Informe' : 'Informe / PDF'}
          </Button>
          {o.puedeCerrar && (
            <Button color='red' size={mobile ? 'md' : 'lg'} h={mobile ? 52 : undefined} leftSection={<IconLock size={18} />} onClick={() => setConfirmar('SUPERVISOR')} data-testid='ot-cerrar'>
              {mobile ? 'Cerrar' : 'Cerrar bitácora'}
            </Button>
          )}
          {o.puedeVerificar && (
            <Button size={mobile ? 'md' : 'lg'} h={mobile ? 52 : undefined} leftSection={<IconSquareCheck size={18} />} onClick={() => setConfirmar('INSPECTOR')} data-testid='ot-verificar'>
              Verificar
            </Button>
          )}
        </Group>
      </Box>

      <ConfirmacionBitacoraModal
        opened={confirmar !== null}
        onClose={() => setConfirmar(null)}
        rol={confirmar ?? 'SUPERVISOR'}
        titulo={confirmar === 'INSPECTOR' ? `Verificar bitácora ${codigoOt(o.consecutivo)}` : `Cerrar bitácora ${codigoOt(o.consecutivo)}`}
        personas={personasConfirman}
        cargando={confirmar === 'SUPERVISOR' && supervisores.loading}
        conObservacion={confirmar === 'SUPERVISOR'}
        onConfirmar={confirmarBitacora}
      />

      {o.puedeGestionar && (
        <AgregarOperadoresModal
          opened={agregar}
          onClose={() => setAgregar(false)}
          idCompany={company.idCompany}
          idOrden={o.id}
          yaProgramados={o.operadores.map((p) => p.id)}
          onDone={async (n) => {
            setAgregar(false);
            const text = n === 1 ? 'Se agregó 1 operario a la bitácora.' : `Se agregaron ${n} operarios a la bitácora.`;
            setAviso({ ok: true, text });
            toast.success(text);
            await detalle.reload(true);
            arriba();
          }}
        />
      )}
    </Stack>
  );
}

/** El supervisor agrega operarios del maestro a la bitácora abierta (solo se agregan, nunca se quitan). */
function AgregarOperadoresModal({
  opened,
  onClose,
  idCompany,
  idOrden,
  yaProgramados,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  idCompany: number;
  idOrden: number;
  yaProgramados: number[];
  onDone: (agregados: number) => void;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const maestro = useOtFetch<{ operadores: OperadorMaestro[] }>(opened ? `/api/bitacora-proceso/operadores?company=${idCompany}` : null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disponibles = (maestro.data?.operadores ?? []).filter((p) => !yaProgramados.includes(p.id_operador));

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await otSend<{ agregados: number }>(`/api/bitacora-proceso/${idOrden}/operadores?company=${idCompany}`, 'POST', { operadores: sel.map(Number) });
      setSel([]);
      onDone(r.agregados);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={() => !busy && onClose()} title={<Text fw={700} size='lg'>Agregar operarios</Text>} fullScreen={mobile} size='md' radius={mobile ? 0 : 'md'}>
      <Stack gap='md'>
        {error && <Alert color='red' icon={<IconAlertTriangle size={18} />}>{error}</Alert>}
        {maestro.loading ? (
          <Loader size='sm' />
        ) : disponibles.length === 0 ? (
          <Text c='dimmed'>Todos los operarios activos ya están en esta bitácora. Agregue operarios nuevos en el catálogo (Operarios).</Text>
        ) : (
          <ScrollArea.Autosize mah={mobile ? 420 : 320} type='auto' offsetScrollbars>
            <Checkbox.Group value={sel} onChange={setSel}>
              <Stack gap={6}>
                {disponibles.map((p) => (
                  <Checkbox.Card key={p.id_operador} value={String(p.id_operador)} radius='md' p='sm' withBorder>
                    <Group wrap='nowrap' gap='sm' mih={40}>
                      <Checkbox.Indicator size='md' />
                      <Text fw={500}>{p.nombre}</Text>
                    </Group>
                  </Checkbox.Card>
                ))}
              </Stack>
            </Checkbox.Group>
          </ScrollArea.Autosize>
        )}
        <Group grow={mobile} justify='flex-end'>
          <Button variant='default' size='md' h={52} onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size='md' h={52} onClick={guardar} loading={busy} disabled={sel.length === 0}>
            Agregar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
