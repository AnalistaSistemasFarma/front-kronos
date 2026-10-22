'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Modal, Paper, PinInput, Radio, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconLock, IconSquareCheck, IconUserCheck } from '@tabler/icons-react';
import { OT_CONFIRMACION_TEXTO, OT_LIMITS, OT_PIN_LONGITUD, OT_ROL_LABEL, type OtFirmaRol } from '../../lib/bitacora-proceso/constants';

/**
 * VISTO BUENO de la bitácora (B2/B3, revisión con Farmalógica del 2026-10-15): un botón
 * «Sí, confirmo», SIN contraseña.
 *   - Operario: toca su nombre entre los programados y confirma.
 *   - Supervisor, inspector o jefe de producción: elige su nombre. Si es la persona de
 *     la SESIÓN, basta «Sí, confirmo». Si no (cuenta compartida «Producción» de la
 *     tablet), escribe su PIN personal de 4 dígitos, que valida el servidor.
 * Celular y tablet primero: pantalla completa en el celular y botones grandes.
 */
export interface Confirmante {
  id: string;
  name: string;
}

export interface DatosConfirmacion {
  persona?: string;
  operador?: number;
  pin?: string;
  observacion: string;
}

export default function ConfirmacionBitacoraModal({
  opened,
  onClose,
  rol,
  titulo,
  personas,
  operadores = [],
  idUsuarioSesion,
  cargando,
  onConfirmar,
}: {
  opened: boolean;
  onClose: () => void;
  rol: OtFirmaRol;
  titulo: string;
  /** Personas que pueden confirmar (al cerrar: supervisores y el jefe designado; si no, el inspector o el jefe designado). */
  personas: Confirmante[];
  /** Operarios programados (rol OPERARIO). */
  operadores?: Array<{ id: number; nombre: string; activo: boolean }>;
  /** user.id de la sesión: si coincide con la persona elegida, no se pide PIN. */
  idUsuarioSesion: string;
  cargando?: boolean;
  onConfirmar: (datos: DatosConfirmacion) => Promise<void>;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [persona, setPersona] = useState<string | null>(null);
  const [operador, setOperador] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setPin('');
    setObservacion('');
    setError(null);
    setPersona(null);
    setOperador(null);
  }, [opened]);

  // Si solo hay una persona posible (el inspector o el jefe designado), viene elegida. Al cerrar
  // desde su propio computador (R4), si la persona de la sesión está en la lista, viene elegida ella.
  useEffect(() => {
    if (!opened || rol === 'OPERARIO') return;
    if (personas.length === 1) setPersona(personas[0].id);
    else if (personas.some((p) => p.id === idUsuarioSesion)) setPersona(idUsuarioSesion);
  }, [opened, personas, rol, idUsuarioSesion]);

  const esOperario = rol === 'OPERARIO';
  const sesionPropia = !esOperario && persona !== null && persona === idUsuarioSesion;
  const pidePin = !esOperario && persona !== null && !sesionPropia;
  const listo = esOperario ? operador !== null : persona !== null && (!pidePin || pin.length === OT_PIN_LONGITUD);

  const confirmar = async () => {
    if (esOperario && operador === null) return setError('Toque su nombre.');
    if (!esOperario && !persona) return setError('Elija su nombre.');
    if (pidePin && pin.length !== OT_PIN_LONGITUD) return setError(`Escriba su PIN de ${OT_PIN_LONGITUD} dígitos.`);
    setBusy(true);
    setError(null);
    try {
      await onConfirmar({
        ...(esOperario ? { operador: operador! } : { persona: persona! }),
        ...(pidePin ? { pin } : {}),
        observacion: observacion.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={() => !busy && onClose()}
      title={<Text fw={700} size='lg'>{titulo}</Text>}
      fullScreen={mobile}
      size='lg'
      radius={mobile ? 0 : 'md'}
      data-testid='ot-confirmacion-modal'
    >
      <Stack gap='md' pb={mobile ? 104 : 0}>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='ot-confirmacion-error'>
            {error}
          </Alert>
        )}

        <Box>
          <Text fw={600} size='md' mb={4}>
            {esOperario ? '1. Toque su nombre (operario)' : `1. ¿Quién da el visto bueno? (${OT_ROL_LABEL[rol]})`}
          </Text>
          {cargando ? (
            <Loader size='sm' />
          ) : esOperario ? (
            operadores.length === 0 ? (
              <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>Esta bitácora no tiene operarios programados.</Alert>
            ) : (
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing='sm' data-testid='ot-confirma-operadores'>
                {operadores.map((p) => (
                  <Button
                    key={p.id}
                    size='xl'
                    h={72}
                    fullWidth
                    disabled={!p.activo}
                    variant={operador === p.id ? 'filled' : 'default'}
                    leftSection={operador === p.id ? <IconUserCheck size={22} /> : undefined}
                    onClick={() => setOperador(p.id)}
                    styles={{ label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }}
                    data-testid='ot-confirma-operador'
                  >
                    {p.nombre}
                  </Button>
                ))}
              </SimpleGrid>
            )
          ) : personas.length === 0 ? (
            <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
              {rol === 'SUPERVISOR'
                ? 'No hay quien pueda cerrar: no hay supervisores asignados en esta empresa ni jefe de producción designado en la bitácora. Un supervisor (Gestión) los asigna en Catálogo → Responsables.'
                : `Esta bitácora no tiene ${OT_ROL_LABEL[rol].toLowerCase()} designado.`}
            </Alert>
          ) : (
            <Radio.Group value={persona} onChange={(v) => { setPersona(v); setPin(''); }}>
              <Stack gap={6} data-testid='ot-confirmantes'>
                {personas.map((p) => (
                  <Radio.Card key={p.id} value={p.id} radius='md' p='sm' withBorder>
                    <Group wrap='nowrap' gap='sm' mih={48}>
                      <Radio.Indicator size='md' />
                      <Text fw={500} size='lg'>{p.name}</Text>
                      {p.id === idUsuarioSesion && <Text size='sm' c='dimmed'>(su sesión)</Text>}
                    </Group>
                  </Radio.Card>
                ))}
              </Stack>
            </Radio.Group>
          )}
        </Box>

        {sesionPropia && (
          <Alert color='blue' variant='light' icon={<IconUserCheck size={18} />} data-testid='ot-sesion-propia'>
            Está en su propia sesión: no necesita PIN.
          </Alert>
        )}
        {pidePin && (
          <Box data-testid='ot-pin-bloque'>
            <Group gap={6} mb={4}>
              <IconLock size={18} />
              <Text fw={600} size='md'>2. Su PIN de bitácora</Text>
            </Group>
            <Text size='xs' c='dimmed' mb={6}>
              Esta tablet tiene abierta otra cuenta. Escriba su PIN personal de {OT_PIN_LONGITUD} dígitos (se configura en «Configurar PIN de bitácora»).
            </Text>
            <PinInput
              length={OT_PIN_LONGITUD}
              type='number'
              mask
              size='xl'
              inputMode='numeric'
              oneTimeCode={false}
              value={pin}
              onChange={setPin}
              aria-label='PIN de bitácora'
              data-testid='ot-pin'
            />
          </Box>
        )}

        {rol === 'SUPERVISOR' && (
          <Textarea
            size='md'
            label='Observación de cierre (opcional)'
            autosize
            minRows={2}
            maxRows={5}
            maxLength={OT_LIMITS.observacionCierre}
            value={observacion}
            onChange={(e) => setObservacion(e.currentTarget.value)}
            data-testid='ot-observacion-cierre'
          />
        )}

        <Paper withBorder radius='md' p='sm' bg='var(--mantine-color-default-hover)'>
          <Text size='md'>{OT_CONFIRMACION_TEXTO[rol]}</Text>
        </Paper>

        <Box
          pos={mobile ? 'fixed' : 'static'}
          bottom={0}
          left={0}
          right={0}
          p={mobile ? 'md' : 0}
          bg='var(--mantine-color-body)'
          style={mobile ? { borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 2 } : undefined}
        >
          <Group grow={mobile} justify='flex-end' gap='sm'>
            <Button variant='default' size='lg' h={60} onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button
              size='lg'
              h={60}
              color={rol === 'SUPERVISOR' ? 'red' : undefined}
              leftSection={<IconSquareCheck size={22} />}
              onClick={confirmar}
              loading={busy}
              disabled={!listo}
              data-testid='ot-confirmar'
            >
              Sí, confirmo
            </Button>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
