'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconCamera, IconTrash } from '@tabler/icons-react';
import { PHOTO_MAX_SIDE } from '../../lib/it-dashboard/photo';
import { iconForAssetType } from './assetTypeIcons';

/** Shrinks the picture in the browser (longest side PHOTO_MAX_SIDE, JPEG) before upload. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite procesar la imagen.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Picture of the asset at the top-right of the detail window. Without a photo
 * it shows the illustration of its type; the camera button uploads or
 * replaces the photo and the trash button removes it.
 */
export default function AssetPhoto({ assetId, typeName }: { assetId: number; typeName: string | null }) {
  const [version, setVersion] = useState(0);
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const Icon = iconForAssetType(typeName ?? '');

  useEffect(() => {
    setHasPhoto(null);
    setError(null);
  }, [assetId]);

  const src = `/api/it-dashboard/assets/${assetId}/photo?v=${version}`;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (!file.type.startsWith('image/')) throw new Error('Elija una imagen (JPG, PNG o WEBP).');
      const image = await shrink(file);
      const res = await fetch(`/api/it-dashboard/assets/${assetId}/photo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar la imagen.');
      setHasPhoto(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la imagen.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-dashboard/assets/${assetId}/photo`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo quitar la imagen.');
      setHasPhoto(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar la imagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box style={{ width: 170, flexShrink: 0 }}>
      <Box
        style={{
          position: 'relative',
          width: 170,
          height: 120,
          borderRadius: 'var(--mantine-radius-md)',
          border: '1px solid var(--mantine-color-default-border)',
          background: 'var(--mantine-color-default)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasPhoto !== false ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not static
          <img
            key={src}
            src={src}
            alt='Imagen del activo'
            onLoad={() => setHasPhoto(true)}
            onError={() => setHasPhoto(false)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: hasPhoto ? 'block' : 'none',
              background: '#fff',
            }}
          />
        ) : null}
        {!hasPhoto ? <Icon size={64} stroke={1.2} color='var(--mantine-color-dimmed)' /> : null}
        {busy ? (
          <Box style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.6)' }}>
            <Loader size='sm' />
          </Box>
        ) : null}
        <Group gap={4} style={{ position: 'absolute', right: 6, bottom: 6 }}>
          <Tooltip label={hasPhoto ? 'Cambiar imagen' : 'Subir imagen'} withArrow>
            <ActionIcon variant='filled' size='sm' radius='xl' onClick={() => input.current?.click()} disabled={busy} aria-label='Subir imagen del activo'>
              <IconCamera size={14} />
            </ActionIcon>
          </Tooltip>
          {hasPhoto ? (
            <Tooltip label='Quitar imagen' withArrow>
              <ActionIcon variant='filled' color='red' size='sm' radius='xl' onClick={() => void remove()} disabled={busy} aria-label='Quitar imagen del activo'>
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Box>
      <input
        ref={input}
        type='file'
        accept='image/jpeg,image/png,image/webp'
        hidden
        onChange={(e) => void upload(e.currentTarget.files?.[0])}
      />
      {error ? (
        <Text size='xs' c='red' mt={4}>
          {error}
        </Text>
      ) : !hasPhoto && hasPhoto !== null ? (
        <Text size='xs' c='dimmed' mt={4} ta='center'>
          Sin imagen · use la cámara para subirla
        </Text>
      ) : null}
    </Box>
  );
}
