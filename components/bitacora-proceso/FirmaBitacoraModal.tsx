'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Group, Image, Loader, Modal, Paper, PasswordInput, Stack, Text, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconSignature } from '@tabler/icons-react';
import SignaturePad from '../orion/SignaturePad';
import { SIGNING_LEGAL_COPY } from '../../lib/orion/signingLegalConsent';
import { OT_FIRMA_SIGNIFICADO, OT_LIMITS, type OtFirmaRol } from '../../lib/bitacora-proceso/constants';

/**
 * Firma electrónica de la bitácora («Cerró» del supervisor o «Verificó» del
 * inspector). Reutiliza las piezas de SynerLink: consentimiento de firma
 * electrónica de GSS Firma, firma REGISTRADA de la persona en GSS Firma (si no
 * tiene, puede dibujarla con el mismo panel de Orión y guardarla allá) y la
 * contraseña de SynerLink. Celular primero: pantalla completa en el celular.
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
  onFirmar: (datos: { password: string; observacion: string }) => Promise<void>;
}) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [acepto, setAcepto] = useState(false);
  const [password, setPassword] = useState('');
  const [observacion, setObservacion] = useState('');
  const [firma, setFirma] = useState<EstadoFirma>({ tipo: 'cargando' });
  const [dibujar, setDibujar] = useState(false);
  const [guardandoFirma, setGuardandoFirma] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = SIGNING_LEGAL_COPY.ELECTRONIC;

  useEffect(() => {
    if (!opened) return;
    setAcepto(false);
    setPassword('');
    setObservacion('');
    setDibujar(false);
    setError(null);
    setFirma({ tipo: 'cargando' });
    let activo = true;
    fetch('/api/integrations/orion/signature-embed', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { hasSignature?: boolean; dataUrl?: string | null };
        if (!activo) return;
        if (!res.ok) setFirma({ tipo: 'no-disponible' });
        else if (body.hasSignature && body.dataUrl) setFirma({ tipo: 'con', dataUrl: body.dataUrl });
        else setFirma({ tipo: 'sin' });
      })
      .catch(() => activo && setFirma({ tipo: 'no-disponible' }));
    return () => {
      activo = false;
    };
  }, [opened]);

  const guardarFirma = async (dataUrl: string) => {
    setGuardandoFirma(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/signature-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl: dataUrl, method: 'drawn' }),
      });
      if (!res.ok) throw new Error('No se pudo guardar la firma en GSS Firma. Puede firmar igual sin imagen.');
      setFirma({ tipo: 'con', dataUrl });
      setDibujar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardandoFirma(false);
    }
  };

  const firmar = async () => {
    if (!acepto) return setError('Debe leer y aceptar las condiciones de la firma electrónica.');
    if (!password) return setError('Escriba su contraseña de SynerLink para firmar.');
    setBusy(true);
    setError(null);
    try {
      await onFirmar({ password, observacion: observacion.trim() });
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
          <Text fw={500} mb={4}>Su firma registrada (GSS Firma)</Text>
          {firma.tipo === 'cargando' && <Loader size='sm' />}
          {firma.tipo === 'con' && (
            <Paper withBorder radius='md' p='xs' bg='white' maw={320} data-testid='ot-firma-registrada'>
              <Image src={firma.dataUrl} alt='Firma registrada' h={90} fit='contain' />
            </Paper>
          )}
          {firma.tipo === 'sin' && !dibujar && (
            <Stack gap={6}>
              <Text size='sm' c='dimmed'>No tiene una firma registrada. Puede dibujarla ahora (queda en GSS Firma para todo SynerLink) o firmar sin imagen.</Text>
              <Button variant='light' size='md' onClick={() => setDibujar(true)} data-testid='ot-firma-dibujar'>
                Dibujar mi firma
              </Button>
            </Stack>
          )}
          {firma.tipo === 'sin' && dibujar && <SignaturePad onSave={guardarFirma} saving={guardandoFirma} />}
          {firma.tipo === 'no-disponible' && (
            <Text size='sm' c='dimmed'>No se pudo consultar GSS Firma en este momento: la firma electrónica se registra igual, sin imagen.</Text>
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
