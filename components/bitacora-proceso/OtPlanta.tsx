'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconChevronRight, IconLock, IconPrinter, IconHandClick, IconSignature } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_BASE_URL, OT_LIMITS, otPictograma } from '../../lib/bitacora-proceso/constants';
import type { OrdenDetalle } from '../../lib/bitacora-proceso/db';
import type { OtCompanyAccess } from '../../lib/bitacora-proceso/rules';
import { OtIconoActividad } from './otIconos';
import FirmaBitacoraModal from './FirmaBitacoraModal';
import { codigoOt, fmtFechaHora, fmtFechaHoraSeg, fmtHora, otHref, otSend, turnoLabel, useOtFetch } from './otClient';

/**
 * Pantalla de planta (pantalla 3): el auxiliar o el inspector registra la intervención con UN
 * toque + confirmación. Celular/tablet primero: encabezado fijo arriba,
 * botones de 72 px de alto (con guantes), aviso del resultado arriba y en color,
 * y la cronología (más reciente primero). Los registros NO se editan ni se borran.
 */
interface Actividad {
  id_actividad: number;
  nombre: string;
  exige_observacion: boolean;
  icono: string | null;
}

export default function OtPlanta({ company, idOrden }: { company: OtCompanyAccess; idOrden: number }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const detalle = useOtFetch<{ orden: OrdenDetalle }>(`/api/bitacora-proceso/${idOrden}?company=${company.idCompany}`, 20_000);
  const acts = useOtFetch<{ actividades: Actividad[] }>(`/api/bitacora-proceso/actividades?company=${company.idCompany}`);
  const [elegida, setElegida] = useState<Actividad | null>(null);
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; text: string } | null>(null);
  const [firmar, setFirmar] = useState<'SUPERVISOR' | 'INSPECTOR' | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const o = detalle.data?.orden;

  const registrar = async () => {
    if (!elegida || !o) return;
    if (elegida.exige_observacion && !obs.trim()) {
      setModalError('Esta actividad exige una observación.');
      return;
    }
    setBusy(true);
    setModalError(null);
    try {
      const r = await otSend<{ registro: { registradoEn: string; actividad: string } }>(
        `/api/bitacora-proceso/${o.id}/registros?company=${company.idCompany}`,
        'POST',
        { id_actividad: elegida.id_actividad, observacion: obs.trim() || undefined }
      );
      const text = `Registrado: ${r.registro.actividad} a las ${fmtHora(r.registro.registradoEn)}.`;
      setAviso({ ok: true, text });
      toast.success(text);
      setElegida(null);
      setObs('');
      await detalle.reload(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setElegida(null);
      setAviso({ ok: false, text: `No se registró: ${msg}` });
      toast.error(msg);
      await detalle.reload(true);
    } finally {
      setBusy(false);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  /** Cierre firmado (supervisor, «Cerró») o verificación firmada (inspector, «Verificó»). Lanza el error para que el modal lo muestre arriba. */
  const firmarBitacora = async ({ password, observacion }: { password: string; observacion: string }) => {
    if (!o || !firmar) return;
    const accion = firmar === 'SUPERVISOR' ? 'cerrar' : 'verificar';
    await otSend(`/api/bitacora-proceso/${o.id}/${accion}?company=${company.idCompany}`, 'POST', {
      password,
      acepto: true,
      ...(firmar === 'SUPERVISOR' ? { observacion: observacion || undefined } : {}),
    });
    const text =
      firmar === 'SUPERVISOR'
        ? `Bitácora ${codigoOt(o.consecutivo)} cerrada y firmada («Cerró»). Ya no admite registros; falta la verificación del inspector.`
        : `Bitácora ${codigoOt(o.consecutivo)} verificada y firmada («Verificó»).`;
    setFirmar(null);
    setAviso({ ok: true, text });
    toast.success(text);
    await detalle.reload(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
  const firmaInsp = o.firmas.find((f) => f.rol === 'INSPECTOR');
  const estadoLabel = abierta ? 'Abierta' : firmaInsp ? 'Verificada' : 'Por verificar';
  const estadoColor = abierta ? 'green' : firmaInsp ? 'blue' : 'yellow';
  const registrosDesc = [...o.registros].reverse();
  const informeHref = otHref(`${OT_BASE_URL}/${o.id}/informe`, company.idCompany);

  return (
    <Stack gap='md' pb={mobile ? 88 : 0}>
      {/* Encabezado fijo: producto, lote, OP y turno siempre a la vista. */}
      <Card
        withBorder
        shadow='sm'
        radius='md'
        p={{ base: 'sm', sm: 'md' }}
        pos='sticky'
        top={0}
        style={{ zIndex: 20 }}
        data-testid='ot-encabezado'
      >
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
          Cerrada y firmada el {fmtFechaHora(o.cerradaEn)} por {o.cerradaPor ?? '—'}. Ya no admite registros.
          {firmaInsp ? ` Verificada por ${firmaInsp.nombre}.` : ' Pendiente la verificación del inspector.'}
          {o.observacionCierre ? ` Observación: ${o.observacionCierre}` : ''}
        </Alert>
      )}
      {abierta && !o.puedeRegistrar && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} data-testid='ot-no-operario'>
          Usted no figura como auxiliar ni como inspector de esta bitácora: puede consultarla, pero no registrar. Pida al supervisor que lo incluya.
        </Alert>
      )}

      {abierta && o.puedeRegistrar && (
        <Box>
          <Group gap={6} mb='xs'>
            <IconHandClick size={20} />
            <Text fw={600} size='lg'>Toque la actividad que va a registrar</Text>
          </Group>
          {acts.error && <Alert color='red'>{acts.error}</Alert>}
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing='sm' data-testid='ot-actividades'>
            {(acts.data?.actividades ?? []).map((a) => (
              <Button
                key={a.id_actividad}
                size='xl'
                h={80}
                variant='light'
                fullWidth
                onClick={() => {
                  setModalError(null);
                  setObs('');
                  setElegida(a);
                }}
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
        </Box>
      )}

      <Card withBorder radius='md' p={{ base: 'sm', sm: 'md' }}>
        <Group justify='space-between' mb='xs' wrap='wrap'>
          <Text fw={700} size='lg'>
            Cronología <Badge variant='light' ml={4}>{o.registros.length}</Badge>
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
                    <Text size='sm' c='dimmed'>{r.usuario}</Text>
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
          <Text fw={700} size='lg' mb='xs'>Firmas electrónicas</Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='sm'>
            {(['SUPERVISOR', 'INSPECTOR'] as const).map((rol) => {
              const f = rol === 'SUPERVISOR' ? firmaSup : firmaInsp;
              return (
                <Paper key={rol} withBorder radius='md' p='sm' data-testid={`ot-firma-${rol.toLowerCase()}`}>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                    {rol === 'SUPERVISOR' ? 'Cerró (supervisor)' : 'Verificó (inspector)'}
                  </Text>
                  {f ? (
                    <>
                      {f.imagen && (
                        <Paper radius='sm' bg='white' p={4} my={4} maw={240}>
                          <Image src={f.imagen} alt={`Firma de ${f.nombre}`} h={56} fit='contain' />
                        </Paper>
                      )}
                      <Text fw={600}>{f.nombre}</Text>
                      <Text size='sm'>{fmtFechaHoraSeg(f.firmadoEn)}</Text>
                    </>
                  ) : (
                    <Text c='dimmed'>Pendiente{rol === 'INSPECTOR' && o.inspector ? ` — ${o.inspector.name}` : ''}</Text>
                  )}
                </Paper>
              );
            })}
          </SimpleGrid>
        </Card>
      )}

      <Card withBorder radius='md' p={{ base: 'sm', sm: 'md' }}>
        <Text fw={700} size='lg' mb='xs'>Encabezado</Text>
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
            <Text size='xs' c='dimmed' tt='uppercase' fw={600}>Inspector</Text>
            <Text>{o.inspector?.name ?? '—'}</Text>
          </div>
        </SimpleGrid>
        <Text size='xs' c='dimmed' tt='uppercase' fw={600} mt='sm' mb={4}>Auxiliares</Text>
        <Group gap={6} wrap='wrap'>
          {o.operarios.map((p) => (
            <Badge key={p.id} variant='outline' size='lg' style={{ textTransform: 'none' }}>
              {p.name}
            </Badge>
          ))}
        </Group>
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
            <Button
              color='red'
              size={mobile ? 'md' : 'lg'}
              h={mobile ? 52 : undefined}
              leftSection={<IconLock size={18} />}
              onClick={() => setFirmar('SUPERVISOR')}
              data-testid='ot-cerrar'
            >
              {mobile ? 'Cerrar y firmar' : 'Cerrar y firmar'}
            </Button>
          )}
          {o.puedeVerificar && (
            <Button
              size={mobile ? 'md' : 'lg'}
              h={mobile ? 52 : undefined}
              leftSection={<IconSignature size={18} />}
              onClick={() => setFirmar('INSPECTOR')}
              data-testid='ot-verificar'
            >
              {mobile ? 'Verificar' : 'Verificar y firmar'}
            </Button>
          )}
        </Group>
      </Box>

      <Modal
        opened={elegida !== null}
        onClose={() => !busy && setElegida(null)}
        title={<Text fw={700} size='lg'>Confirmar registro</Text>}
        centered
        size='md'
        data-testid='ot-confirmar-modal'
      >
        {elegida && (
          <Stack gap='md'>
            {modalError && (
              <Alert color='red' icon={<IconAlertTriangle size={18} />}>
                {modalError}
              </Alert>
            )}
            <Text size='xl' fw={700} data-testid='ot-confirmar-actividad'>
              {elegida.nombre}
            </Text>
            <Text size='sm' c='dimmed'>
              Se guardará con la hora del servidor y su usuario. Después no se puede editar ni borrar.
            </Text>
            <Textarea
              size='md'
              label={elegida.exige_observacion ? 'Observación (obligatoria)' : 'Observación (opcional)'}
              required={elegida.exige_observacion}
              autosize
              minRows={2}
              maxRows={5}
              maxLength={OT_LIMITS.observacion}
              value={obs}
              onChange={(e) => setObs(e.currentTarget.value)}
              description={`${obs.length}/${OT_LIMITS.observacion}`}
              data-testid='ot-observacion'
            />
            <Group grow gap='sm'>
              <Button variant='default' size='lg' h={56} onClick={() => setElegida(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button size='lg' h={56} onClick={registrar} loading={busy} leftSection={<IconCheck size={20} />} data-testid='ot-registrar'>
                Registrar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <FirmaBitacoraModal
        opened={firmar !== null}
        onClose={() => setFirmar(null)}
        rol={firmar ?? 'SUPERVISOR'}
        titulo={firmar === 'INSPECTOR' ? `Verificar bitácora ${codigoOt(o.consecutivo)}` : `Cerrar bitácora ${codigoOt(o.consecutivo)}`}
        conObservacion={firmar === 'SUPERVISOR'}
        onFirmar={firmarBitacora}
      />
    </Stack>
  );
}
