'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, PasswordInput, PinInput, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconCheck, IconKey } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { OT_PIN_LONGITUD, OT_PIN_MAX_FALLOS } from '../../lib/bitacora-proceso/constants';
import { otSend, useOtFetch } from './otClient';

/**
 * «Configurar PIN de bitácora» (B3, 2026-10-15): la persona de la SESIÓN fija o cambia
 * su PIN de 4 dígitos, con el que da su visto bueno desde la cuenta compartida de la
 * tablet. Pide una vez su contraseña de SynerLink. El PIN nunca se muestra ni se guarda
 * en claro (bcrypt en el servidor).
 */
export default function OtPinPropio() {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [abierto, setAbierto] = useState(false);
  const estado = useOtFetch<{ configurado: boolean; bloqueado: boolean }>('/api/bitacora-proceso/pin');
  const [pin, setPin] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setPin('');
    setConfirmacion('');
    setPassword('');
    setError(null);
  }, [abierto]);

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await otSend('/api/bitacora-proceso/pin', 'POST', { pin, confirmacion, password });
      toast.success('PIN de bitácora guardado.');
      setAbierto(false);
      await estado.reload(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const e = estado.data;
  return (
    <>
      <Button variant='default' size='md' leftSection={<IconKey size={18} />} onClick={() => setAbierto(true)} data-testid='ot-pin-propio'>
        Configurar PIN de bitácora
        {e?.bloqueado ? (
          <Badge ml={8} color='red' variant='light'>Bloqueado</Badge>
        ) : e?.configurado ? (
          <Badge ml={8} color='green' variant='light'>Activo</Badge>
        ) : null}
      </Button>
      <Modal opened={abierto} onClose={() => !busy && setAbierto(false)} title={<Text fw={700} size='lg'>Configurar PIN de bitácora</Text>} fullScreen={mobile} size='md' radius={mobile ? 0 : 'md'} data-testid='ot-pin-modal'>
        <Stack gap='md'>
          <Text size='sm'>
            Con este PIN de {OT_PIN_LONGITUD} dígitos da su visto bueno en la tablet de planta, aunque esté abierta la cuenta compartida. Es personal: no lo comparta.
            {` Tras ${OT_PIN_MAX_FALLOS} intentos fallidos se bloquea hasta que lo configure de nuevo o un supervisor lo restablezca.`}
          </Text>
          {e?.bloqueado && <Alert color='red' icon={<IconAlertTriangle size={16} />}>Su PIN está bloqueado: configure uno nuevo.</Alert>}
          {error && <Alert color='red' icon={<IconAlertTriangle size={16} />} data-testid='ot-pin-error'>{error}</Alert>}
          <div>
            <Text fw={600} mb={4}>PIN nuevo</Text>
            <PinInput length={OT_PIN_LONGITUD} type='number' mask size='xl' inputMode='numeric' oneTimeCode={false} value={pin} onChange={setPin} aria-label='PIN nuevo' data-testid='ot-pin-nuevo' />
          </div>
          <div>
            <Text fw={600} mb={4}>Repita el PIN</Text>
            <PinInput length={OT_PIN_LONGITUD} type='number' mask size='xl' inputMode='numeric' oneTimeCode={false} value={confirmacion} onChange={setConfirmacion} aria-label='Repita el PIN' data-testid='ot-pin-confirmacion' />
          </div>
          <PasswordInput size='md' label='Su contraseña de SynerLink' description='Solo para confirmar que es usted. No se guarda.' autoComplete='current-password' value={password} onChange={(ev) => setPassword(ev.currentTarget.value)} data-testid='ot-pin-password' />
          <Group grow={mobile} justify='flex-end'>
            <Button variant='default' size='lg' h={56} onClick={() => setAbierto(false)} disabled={busy}>Cancelar</Button>
            <Button size='lg' h={56} leftSection={<IconCheck size={20} />} onClick={guardar} loading={busy} disabled={pin.length !== OT_PIN_LONGITUD || confirmacion.length !== OT_PIN_LONGITUD || !password} data-testid='ot-pin-guardar'>
              Guardar PIN
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
