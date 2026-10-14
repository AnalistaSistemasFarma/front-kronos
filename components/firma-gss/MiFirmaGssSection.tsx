'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Image, Loader, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconSignature } from '@tabler/icons-react';
import CapturaFirma, { type FirmaCapturada } from './CapturaFirma';

type Resultado = { tipo: 'ok' | 'error'; mensaje: string };
interface Vista {
  disponible: boolean;
  hasSignature: boolean;
  dataUrl: string | null;
  method: string | null;
}

/**
 * «Mi firma» en el perfil: la firma registrada de la persona en GSS Firma (el
 * maestro de firmas compartido de SynerLink). Cualquier usuario puede
 * registrarla o cambiarla, dibujada o SUBIENDO una imagen de su firma
 * manuscrita; se guarda tras confirmar la contraseña de SynerLink y queda para
 * reutilizarla al firmar (solicitudes, Bitácora de Proceso).
 * El SGC tiene su propio maestro de firmas y no se ve afectado.
 */
export default function MiFirmaGssSection({ onResultado }: { onResultado: (r: Resultado) => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [editando, setEditando] = useState(false);
  const [capturada, setCapturada] = useState<FirmaCapturada | null>(null);
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/firma-gss/mi-firma', { cache: 'no-store' });
      setVista(res.ok ? ((await res.json()) as Vista) : { disponible: false, hasSignature: false, dataUrl: null, method: null });
    } catch {
      setVista({ disponible: false, hasSignature: false, dataUrl: null, method: null });
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cancelar = () => {
    setEditando(false);
    setCapturada(null);
    setPassword('');
    setError(null);
  };

  const guardar = async () => {
    if (!capturada) return;
    if (!password) return setError('Escriba su contraseña de SynerLink para guardar su firma.');
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/firma-gss/mi-firma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: capturada.imagen, metodo: capturada.metodo, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; dataUrl?: string; method?: string };
      if (!res.ok) throw new Error(body.error || 'No se pudo guardar su firma.');
      setVista({ disponible: true, hasSignature: true, dataUrl: body.dataUrl ?? capturada.imagen, method: body.method ?? capturada.metodo });
      cancelar();
      onResultado({ tipo: 'ok', mensaje: 'Firma guardada en GSS Firma. Se usará la próxima vez que firme.' });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudo guardar su firma.';
      setError(mensaje);
      setPassword('');
      onResultado({ tipo: 'error', mensaje });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder padding='lg' radius='md' data-testid='mi-firma-gss'>
      <Title order={3} mb='xs'>
        <Group gap='xs'>
          <IconSignature size={20} />
          Mi firma (GSS Firma)
        </Group>
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        Su firma registrada para firmar en SynerLink. Puede dibujarla o subir una imagen de su firma manuscrita. Solo usted puede registrar la suya.
      </Text>

      {!vista && <Loader size='sm' />}

      {vista && !vista.disponible && (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} mb='md'>
          GSS Firma no responde en este momento. Intente más tarde.
        </Alert>
      )}

      {vista && vista.disponible && !editando && (
        <Stack gap='sm'>
          {vista.hasSignature && vista.dataUrl ? (
            <Group gap='sm' align='center'>
              <Paper withBorder radius='md' p='xs' bg='white' maw={320} data-testid='mi-firma-gss-actual'>
                <Image src={vista.dataUrl} alt='Su firma registrada' h={90} fit='contain' />
              </Paper>
              <Badge variant='light'>{vista.method === 'uploaded' ? 'Imagen subida' : 'Dibujada'}</Badge>
            </Group>
          ) : (
            <Text size='sm'>Todavía no tiene una firma registrada.</Text>
          )}
          <Group>
            <Button size='md' variant='light' onClick={() => setEditando(true)} data-testid='mi-firma-gss-cambiar'>
              {vista.hasSignature ? 'Cambiar mi firma' : 'Registrar mi firma'}
            </Button>
          </Group>
        </Stack>
      )}

      {vista && vista.disponible && editando && (
        <Stack gap='md'>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='mi-firma-gss-error'>
              {error}
            </Alert>
          )}
          {!capturada ? (
            <CapturaFirma onCapturada={setCapturada} />
          ) : (
            <Stack gap='sm'>
              <Paper withBorder radius='md' p='xs' bg='white' maw={360}>
                <Image src={capturada.imagen} alt='Su nueva firma' h={100} fit='contain' />
              </Paper>
              <Button variant='subtle' size='sm' w='fit-content' onClick={() => setCapturada(null)} disabled={guardando}>
                Volver a capturarla
              </Button>
              <PasswordInput
                size='md'
                label='Contraseña de SynerLink'
                description='Confirma que es usted quien registra su firma. No se guarda.'
                autoComplete='current-password'
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                data-testid='mi-firma-gss-password'
              />
            </Stack>
          )}
          <Group justify='flex-end' gap='sm'>
            <Button variant='default' size='md' onClick={cancelar} disabled={guardando}>
              Cancelar
            </Button>
            {capturada && (
              <Button size='md' onClick={guardar} loading={guardando} disabled={!password} data-testid='mi-firma-gss-guardar'>
                Guardar mi firma
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Card>
  );
}
