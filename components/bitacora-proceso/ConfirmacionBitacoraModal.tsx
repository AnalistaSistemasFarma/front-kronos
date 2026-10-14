'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Group, Loader, Modal, Paper, PasswordInput, Radio, Stack, Text, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconSquareCheck } from '@tabler/icons-react';
import { OT_CONFIRMACION_TEXTO, OT_LIMITS, OT_ROL_LABEL, type OtFirmaRol } from '../../lib/bitacora-proceso/constants';

/**
 * Confirmación «Cerró» (supervisor) o «Verificó» (jefe de producción) — A4,
 * 2026-10-14. Reemplaza la firma con imagen: es un CHECK con la contraseña de
 * SynerLink de QUIEN CONFIRMA. La tablet usa una cuenta compartida de planta,
 * así que la persona elige SU nombre de la lista y escribe SU contraseña; el
 * servidor la valida contra la cuenta de esa persona. Sin imagen de firma ni
 * consentimiento de GSS Firma. Celular primero: pantalla completa en el celular.
 */
export interface Confirmante {
  id: string;
  name: string;
}

export default function ConfirmacionBitacoraModal({
  opened,
  onClose,
  rol,
  titulo,
  personas,
  cargando,
  conObservacion,
  onConfirmar,
}: {
  opened: boolean;
  onClose: () => void;
  rol: OtFirmaRol;
  titulo: string;
  /** Personas que pueden confirmar (supervisores al cerrar; el jefe de producción designado al verificar). */
  personas: Confirmante[];
  cargando?: boolean;
  conObservacion?: boolean;
  onConfirmar: (datos: { firmante: string; password: string; observacion: string }) => Promise<void>;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [firmante, setFirmante] = useState<string | null>(null);
  const [confirmo, setConfirmo] = useState(false);
  const [password, setPassword] = useState('');
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setConfirmo(false);
    setPassword('');
    setObservacion('');
    setError(null);
    setFirmante(null);
  }, [opened]);

  // Si solo hay una persona posible (p. ej. el jefe de producción designado), viene elegida.
  useEffect(() => {
    if (opened && personas.length === 1) setFirmante(personas[0].id);
  }, [opened, personas]);

  const confirmar = async () => {
    if (!firmante) return setError('Elija su nombre.');
    if (!confirmo) return setError('Marque la casilla de confirmación.');
    if (!password) return setError('Escriba su contraseña de SynerLink.');
    setBusy(true);
    setError(null);
    try {
      await onConfirmar({ firmante, password, observacion: observacion.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassword('');
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
      <Stack gap='md' pb={mobile ? 96 : 0}>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='ot-confirmacion-error'>
            {error}
          </Alert>
        )}

        <Box>
          <Text fw={600} size='md' mb={4}>
            ¿Quién confirma? ({OT_ROL_LABEL[rol]})
          </Text>
          <Text size='xs' c='dimmed' mb={6}>
            Elija su propio nombre y escriba su propia contraseña de SynerLink, aunque la tablet tenga abierta otra cuenta.
          </Text>
          {cargando ? (
            <Loader size='sm' />
          ) : personas.length === 0 ? (
            <Alert color='yellow' icon={<IconAlertTriangle size={16} />}>
              {rol === 'SUPERVISOR'
                ? 'No hay supervisores (permiso Bitácora de Proceso: Gestión) disponibles en esta empresa.'
                : 'Esta bitácora no tiene jefe de producción designado.'}
            </Alert>
          ) : (
            <Radio.Group value={firmante} onChange={setFirmante}>
              <Stack gap={6} data-testid='ot-confirmantes'>
                {personas.map((p) => (
                  <Radio.Card key={p.id} value={p.id} radius='md' p='sm' withBorder>
                    <Group wrap='nowrap' gap='sm' mih={44}>
                      <Radio.Indicator size='md' />
                      <Text fw={500} size='lg'>{p.name}</Text>
                    </Group>
                  </Radio.Card>
                ))}
              </Stack>
            </Radio.Group>
          )}
        </Box>

        {conObservacion && (
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

        <Paper withBorder radius='md' p='sm'>
          <Checkbox
            size='lg'
            checked={confirmo}
            onChange={(e) => setConfirmo(e.currentTarget.checked)}
            label={<Text size='md'>{OT_CONFIRMACION_TEXTO[rol]}</Text>}
            data-testid='ot-confirmo'
          />
        </Paper>

        <PasswordInput
          size='md'
          label='Su contraseña de SynerLink'
          description='Confirma que es usted. No se guarda.'
          autoComplete='off'
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          data-testid='ot-confirmacion-password'
        />

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
            <Button variant='default' size='md' h={52} onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button
              size='md'
              h={52}
              color={rol === 'SUPERVISOR' ? 'red' : undefined}
              leftSection={<IconSquareCheck size={18} />}
              onClick={confirmar}
              loading={busy}
              disabled={!firmante || !confirmo || !password}
              data-testid='ot-confirmar'
            >
              {rol === 'SUPERVISOR' ? 'Confirmar cierre' : 'Confirmar verificación'}
            </Button>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
