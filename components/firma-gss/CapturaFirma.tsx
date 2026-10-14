'use client';

import { useState } from 'react';
import { Alert, Button, FileButton, Group, Image, Paper, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPhoto, IconUpload } from '@tabler/icons-react';
import SignaturePad from '../orion/SignaturePad';
import { FirmaArchivoError, prepararImagenFirma } from './imagenFirmaCliente';
import type { FirmaGssMetodo } from '../../lib/firma-gss/miFirma';

export interface FirmaCapturada {
  imagen: string;
  metodo: FirmaGssMetodo;
}

/**
 * Captura de la firma PROPIA para GSS Firma: dibujarla o SUBIR una imagen de
 * la firma manuscrita (PNG o JPG). Celular primero: controles de ancho
 * completo y botones de 48 px. No guarda nada: entrega la imagen a quien la
 * usa, que la envía con la contraseña de SynerLink.
 */
export default function CapturaFirma({ onCapturada, inicial = 'drawn' }: { onCapturada: (f: FirmaCapturada) => void; inicial?: FirmaGssMetodo }) {
  const [modo, setModo] = useState<FirmaGssMetodo>(inicial);
  const [imagen, setImagen] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegir = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setImagen(null);
    setLeyendo(true);
    try {
      setImagen(await prepararImagenFirma(file));
    } catch (e) {
      setError(e instanceof FirmaArchivoError ? e.message : 'No se pudo leer la imagen. Use un PNG o JPG.');
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <Stack gap='sm' data-testid='firma-captura'>
      <SegmentedControl
        fullWidth
        size='md'
        value={modo}
        onChange={(v) => {
          setModo(v as FirmaGssMetodo);
          setError(null);
        }}
        data={[
          { value: 'drawn', label: 'Dibujarla' },
          { value: 'uploaded', label: 'Subir imagen' },
        ]}
        data-testid='firma-captura-modo'
      />

      {modo === 'drawn' && (
        <SignaturePad
          onSave={(dataUrl) => onCapturada({ imagen: dataUrl, metodo: 'drawn' })}
          hint='Dibuje su firma con el dedo o el mouse. Queda en GSS Firma para todo SynerLink.'
          saveLabel='Usar esta firma'
        />
      )}

      {modo === 'uploaded' && (
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Suba una foto o escaneo de SU firma manuscrita sobre fondo blanco (PNG o JPG, máximo 5 MB). Se recorta a la tinta y se le quitan los
            datos ocultos de la foto (ubicación, cámara).
          </Text>
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='firma-captura-error'>
              {error}
            </Alert>
          )}
          {imagen && (
            <Paper withBorder radius='md' p='xs' bg='white' maw={360} data-testid='firma-captura-vista'>
              <Image src={imagen} alt='Vista previa de su firma' h={100} fit='contain' />
            </Paper>
          )}
          <Group grow gap='sm'>
            <FileButton onChange={elegir} accept='image/png,image/jpeg'>
              {(props) => (
                <Button {...props} variant={imagen ? 'default' : 'light'} size='md' h={48} leftSection={<IconUpload size={18} />} loading={leyendo} data-testid='firma-captura-elegir'>
                  {imagen ? 'Elegir otra' : 'Elegir imagen'}
                </Button>
              )}
            </FileButton>
            {imagen && (
              <Button size='md' h={48} leftSection={<IconPhoto size={18} />} onClick={() => onCapturada({ imagen, metodo: 'uploaded' })} data-testid='firma-captura-usar'>
                Usar esta imagen
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
