'use client';

import { useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, Image, Stack, Text } from '@mantine/core';
import { IconFingerprint, IconUpload } from '@tabler/icons-react';
import { BIOMETRIC_CONSENT_COPY } from '../../lib/orion/signingLegalConsent';

type Props = {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
};

/**
 * Captura de huella para SynerLink → Orion.
 * Orion estampa la imagen en cajas kind=fingerprint; aquí solo se aporta el data URL.
 * La autorización biométrica (Ley 1581) se exige en SignerIdentityForm.
 */
export default function FingerprintCapture({ value, onChange, disabled = false }: Props) {
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef<() => void>(null);

  const handleFile = (file: File | null) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Suba una imagen (PNG o JPG) de la huella.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('La imagen no debe superar 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) {
        setError('No se pudo leer la imagen de huella.');
        return;
      }
      onChange(dataUrl);
    };
    reader.onerror = () => setError('Error al leer el archivo.');
    reader.readAsDataURL(file);
  };

  return (
    <Stack gap='sm'>
      <Alert color='orange' variant='light' title={BIOMETRIC_CONSENT_COPY.title}>
        <Text size='xs'>{BIOMETRIC_CONSENT_COPY.body}</Text>
      </Alert>
      <Text size='sm' c='dimmed'>
        Este documento exige huella dactilar. Suba una imagen clara del dedo (escáner o foto nítida).
        Orion la colocará en la caja de huella del PDF.
      </Text>

      {value?.startsWith('data:image/') ? (
        <Image
          src={value}
          alt='Vista previa de huella'
          mah={160}
          fit='contain'
          radius='md'
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            background: '#fff',
          }}
        />
      ) : (
        <Group
          justify='center'
          py='xl'
          style={{
            border: '1px dashed var(--mantine-color-gray-4)',
            borderRadius: 12,
            background: 'var(--mantine-color-gray-0)',
          }}
        >
          <IconFingerprint size={36} stroke={1.4} color='var(--mantine-color-gray-5)' />
        </Group>
      )}

      {error ? (
        <Alert color='red' variant='light'>
          {error}
        </Alert>
      ) : null}

      <Group gap='xs'>
        <FileButton
          resetRef={resetRef}
          onChange={handleFile}
          accept='image/png,image/jpeg,image/webp'
          disabled={disabled}
        >
          {(props) => (
            <Button
              {...props}
              variant='light'
              leftSection={<IconUpload size={16} />}
              disabled={disabled}
            >
              {value ? 'Cambiar imagen' : 'Subir huella'}
            </Button>
          )}
        </FileButton>
        {value ? (
          <Button
            variant='subtle'
            color='gray'
            disabled={disabled}
            onClick={() => {
              onChange(null);
              resetRef.current?.();
            }}
          >
            Quitar
          </Button>
        ) : null}
      </Group>
    </Stack>
  );
}
