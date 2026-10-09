'use client';

import { useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, Image, Stack, Text } from '@mantine/core';
import { IconFingerprint, IconUpload } from '@tabler/icons-react';

type Props = {
  value?: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  /** Ya hay huella reutilizada (local / sesión); no forzar nueva carga. */
  fromSaved?: boolean;
};

/**
 * Captura de huella para SynerLink → Orion.
 * Si ya hay imagen guardada, basta con aceptarla (o cambiarla).
 * La autorización biométrica (Ley 1581) se exige en SignerIdentityForm.
 */
export default function FingerprintCapture({
  value,
  onChange,
  disabled = false,
  fromSaved = false,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef<() => void>(null);
  const hasImage = Boolean(value?.startsWith('data:image/'));

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
      {hasImage && fromSaved ? (
        <Alert color='teal' variant='light' title='Huella guardada'>
          <Text size='xs'>
            Ya tiene una huella registrada en este navegador. Acéptela para firmar este documento;
            no es necesario volver a subirla. Puede cambiarla si lo desea.
          </Text>
        </Alert>
      ) : (
        <Text size='sm' c='dimmed'>
          Este documento exige huella dactilar. Suba una imagen clara del dedo (escáner o foto
          nítida). Se reutilizará en próximos documentos de este navegador.
        </Text>
      )}

      {hasImage ? (
        <Image
          src={value!}
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
              {hasImage ? 'Cambiar imagen' : 'Subir huella'}
            </Button>
          )}
        </FileButton>
        {hasImage ? (
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
