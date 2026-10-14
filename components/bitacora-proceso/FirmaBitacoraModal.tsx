'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Group, Image, Loader, Modal, Paper, PasswordInput, Stack, Text, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconSignature } from '@tabler/icons-react';
import CapturaFirma, { type FirmaCapturada } from '../firma-gss/CapturaFirma';
import { SIGNING_LEGAL_COPY } from '../../lib/orion/signingLegalConsent';
import { OT_FIRMA_SIGNIFICADO, OT_LIMITS, type OtFirmaRol } from '../../lib/bitacora-proceso/constants';

/**
 * Firma electrónica de la bitácora («Cerró» del supervisor o «Verificó» del
 * inspector). Reutiliza las piezas de SynerLink: consentimiento de firma
 * electrónica de GSS Firma, firma REGISTRADA de la persona en GSS Firma y la
 * contraseña de SynerLink. Si no tiene firma registrada (o quiere cambiarla),
 * aquí mismo la DIBUJA o SUBE una imagen de su firma manuscrita: viaja con la
 * firma y, tras verificar la contraseña, el servidor la guarda en SU maestro de
 * GSS Firma para la próxima vez (con auditoría). Celular primero: pantalla
 * completa en el celular.
 */
type EstadoFirma = { tipo: 'cargando' } | { tipo: 'con'; dataUrl: string } | { tipo: 'sin' } | { tipo: 'no-disponible' };

export default function FirmaBitacoraModal({
  opened,
  onClose,
  rol,
  titulo,
  conObservacion,
  onFirmar,
}: {
  opened: boolean;
  onClose: () => void;
  rol: OtFirmaRol;
  titulo: string;
  conObservacion?: boolean;
  onFirmar: (datos: { password: string; observacion: string; firmaNueva: FirmaCapturada | null }) => Promise<void>;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [acepto, setAcepto] = useState(false);
  const [password, setPassword] = useState('');
  const [observacion, setObservacion] = useState('');
  const [firma, setFirma] = useState<EstadoFirma>({ tipo: 'cargando' });
  const [capturando, setCapturando] = useState(false);
  const [nueva, setNueva] = useState<FirmaCapturada | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = SIGNING_LEGAL_COPY.ELECTRONIC;

  useEffect(() => {
    if (!opened) return;
    setAcepto(false);
    setPassword('');
    setObservacion('');
    setCapturando(false);
    setNueva(null);
    setError(null);
    setFirma({ tipo: 'cargando' });
    let activo = true;
    fetch('/api/firma-gss/mi-firma', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { disponible?: boolean; hasSignature?: boolean; dataUrl?: string | null };
        if (!activo) return;
        if (!res.ok || !body.disponible) setFirma({ tipo: 'no-disponible' });
        else if (body.hasSignature && body.dataUrl) setFirma({ tipo: 'con', dataUrl: body.dataUrl });
        else setFirma({ tipo: 'sin' });
      })
      .catch(() => activo && setFirma({ tipo: 'no-disponible' }));
    return () => {
      activo = false;
    };
  }, [opened]);

  const firmar = async () => {
    if (!acepto) return setError('Debe leer y aceptar las condiciones de la firma electrónica.');
    if (!password) return setError('Escriba su contraseña de SynerLink para firmar.');
    setBusy(true);
    setError(null);
    try {
      await onFirmar({ password, observacion: observacion.trim(), firmaNueva: nueva });
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
      data-testid='ot-firma-modal'
    >
      <Stack gap='md' pb={mobile ? 96 : 0}>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='ot-firma-error'>
            {error}
          </Alert>
        )}
        <Group gap='xs'>
          <IconSignature size={22} />
          <Text fw={600}>Significado de la firma: «{OT_FIRMA_SIGNIFICADO[rol]}»</Text>
        </Group>

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

        <Box>
          <Text fw={500} mb={4}>Su firma (GSS Firma)</Text>
          {firma.tipo === 'cargando' && <Loader size='sm' />}

          {nueva ? (
            <Stack gap={6}>
              <Paper withBorder radius='md' p='xs' bg='white' maw={320} data-testid='ot-firma-nueva'>
                <Image src={nueva.imagen} alt='Su nueva firma' h={90} fit='contain' />
              </Paper>
              <Text size='sm' c='dimmed'>Se usará en esta firma y se guardará en GSS Firma para la próxima vez.</Text>
              <Button variant='subtle' size='sm' w='fit-content' onClick={() => { setNueva(null); setCapturando(true); }} disabled={busy}>
                Volver a capturarla
              </Button>
            </Stack>
          ) : capturando ? (
            <Stack gap={6}>
              <CapturaFirma onCapturada={(f) => { setNueva(f); setCapturando(false); }} />
              {firma.tipo === 'con' && (
                <Button variant='subtle' size='sm' w='fit-content' onClick={() => setCapturando(false)}>
                  Seguir con mi firma registrada
                </Button>
              )}
            </Stack>
          ) : (
            <>
              {firma.tipo === 'con' && (
                <Stack gap={6}>
                  <Paper withBorder radius='md' p='xs' bg='white' maw={320} data-testid='ot-firma-registrada'>
                    <Image src={firma.dataUrl} alt='Firma registrada' h={90} fit='contain' />
                  </Paper>
                  <Button variant='subtle' size='sm' w='fit-content' onClick={() => setCapturando(true)} data-testid='ot-firma-cambiar'>
                    Usar otra firma (dibujarla o subir imagen)
                  </Button>
                </Stack>
              )}
              {(firma.tipo === 'sin' || firma.tipo === 'no-disponible') && (
                <Stack gap={6}>
                  <Text size='sm' c='dimmed'>
                    {firma.tipo === 'sin'
                      ? 'No tiene una firma registrada. Dibújela o suba una imagen de su firma manuscrita: queda en GSS Firma para todo SynerLink. También puede firmar sin imagen.'
                      : 'No se pudo consultar GSS Firma en este momento. Puede dibujar o subir su firma para esta bitácora, o firmar sin imagen.'}
                  </Text>
                  <Group grow={mobile} gap='sm'>
                    <Button variant='light' size='md' onClick={() => setCapturando(true)} data-testid='ot-firma-dibujar'>
                      Dibujar o subir mi firma
                    </Button>
                  </Group>
                </Stack>
              )}
            </>
          )}
        </Box>

        <Paper withBorder radius='md' p='sm'>
          <Text fw={600} size='sm' mb={4}>{copy.title}</Text>
          <Text size='sm' c='dimmed' mb='xs'>{copy.body}</Text>
          <Checkbox size='md' checked={acepto} onChange={(e) => setAcepto(e.currentTarget.checked)} label={copy.checkbox} data-testid='ot-firma-acepto' />
        </Paper>

        <PasswordInput
          size='md'
          label='Contraseña de SynerLink'
          description='Confirma su identidad. No se guarda.'
          autoComplete='current-password'
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          data-testid='ot-firma-password'
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
              leftSection={<IconSignature size={18} />}
              onClick={firmar}
              loading={busy}
              disabled={!acepto || !password}
              data-testid='ot-firmar'
            >
              {rol === 'SUPERVISOR' ? 'Firmar y cerrar' : 'Firmar verificación'}
            </Button>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
