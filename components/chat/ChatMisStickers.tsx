'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  FileButton,
  Group,
  Loader,
  Modal,
  NativeSelect,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconPhotoUp, IconSend, IconTrash, IconX } from '@tabler/icons-react';
import { chatFetch, chatGetJson } from '../../lib/chat/client';
import {
  MAX_BYTES_STICKER,
  MAX_MIS_STICKERS,
  MAX_NOMBRE_STICKER,
  limpiarNombreSticker,
  textoEstadoPropuesta,
  type EstadoPropuesta,
} from '../../lib/chat/stickers-personales-reglas';
import { catalogoEnMemoria, pedirCatalogo, refrescarCatalogo, suscribirCatalogo, type Catalogo } from './ChatMediaPicker';

/**
 * «MIS STICKERS» (2026-10-21): cargar stickers propios (WebP estático o
 * animado), quitarlos y PROPONERLOS a una empresa. Un administrador ve además
 * las propuestas pendientes y las aprueba (quedan como stickers de esa
 * empresa) o las rechaza.
 *
 * Mantine y los tokens del chat, como el resto de SynerLink. La empresa se
 * escoge con un `NativeSelect` y no con el Select de Mantine: en el celular
 * el Select con lista propia se cierra solo cerca del final de la pantalla
 * (memoria gotcha-select-mantine-movil-se-cierra); el nativo usa el selector
 * del sistema.
 */

type MiSticker = {
  idSticker: number;
  label: string;
  src: string;
  estado: EstadoPropuesta | null;
  idCompany: number | null;
  companyName: string | null;
};
type Propuesta = { idSticker: number; label: string; src: string; autor: string; companyName: string };

const COLOR_ESTADO: Record<EstadoPropuesta, string> = { propuesto: 'yellow', aprobado: 'green', rechazado: 'red' };

async function leerError(res: Response, porDefecto: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || porDefecto;
  } catch {
    return porDefecto;
  }
}

export default function ChatMisStickers({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const enCelular = useMediaQuery('(max-width: 768px)');
  const [catalogo, setCatalogo] = useState<Catalogo | null>(catalogoEnMemoria());
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    void pedirCatalogo().then((c) => vivo && c && setCatalogo(c));
    const dejar = suscribirCatalogo((c) => c && setCatalogo(c));
    return () => {
      vivo = false;
      dejar();
    };
  }, [abierto]);
  const [mios, setMios] = useState<MiSticker[] | null>(null);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const empresas = catalogo?.empresas ?? [];
  const [empresa, setEmpresa] = useState<string>('');
  const puedeRevisar = Boolean(catalogo?.puedeRevisar);

  const cargar = useCallback(async () => {
    setError(null);
    const data = await chatGetJson<{ stickers: MiSticker[] }>('/api/chat/stickers/mios').catch(() => null);
    if (!data) {
      setError('No se pudieron cargar sus stickers.');
      setMios([]);
    } else setMios(data.stickers);
    if (puedeRevisar) {
      const p = await chatGetJson<{ propuestas: Propuesta[] }>('/api/chat/stickers/propuestas').catch(() => null);
      setPropuestas(p?.propuestas ?? []);
    }
  }, [puedeRevisar]);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar]);

  useEffect(() => {
    if (!empresa && empresas.length) setEmpresa(String(empresas[0].id));
  }, [empresa, empresas]);

  // La vista previa local del archivo escogido.
  useEffect(() => {
    if (!archivo) {
      setVista(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const escoger = (f: File | null) => {
    setAviso(null);
    setError(null);
    if (!f) return;
    // Aviso temprano; la validación que manda es la del servidor (lee los bytes).
    if (f.type && f.type !== 'image/webp') {
      setError('El sticker debe ser una imagen WebP (estática o animada).');
      return;
    }
    if (f.size > MAX_BYTES_STICKER) {
      setError('El sticker pesa más de 512 KB.');
      return;
    }
    setArchivo(f);
    if (!nombre) setNombre(f.name.replace(/\.webp$/i, '').replace(/[-_]+/g, ' ').slice(0, MAX_NOMBRE_STICKER));
  };

  const guardar = async () => {
    const limpio = limpiarNombreSticker(nombre);
    if (!archivo || !limpio) {
      setError(!archivo ? 'Escoja el archivo del sticker.' : 'Póngale un nombre al sticker.');
      return;
    }
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      form.append('nombre', limpio);
      // fetch directo: chatFetch pondría Content-Type JSON y el formulario necesita el suyo.
      const res = await fetch('/api/chat/stickers/mios', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        setError(await leerError(res, 'No se pudo guardar el sticker.'));
        return;
      }
      setArchivo(null);
      setNombre('');
      setAviso('Sticker agregado a «Mis stickers».');
      await Promise.all([cargar(), refrescarCatalogo()]);
    } catch {
      setError('No se pudo guardar el sticker. Revise la conexión e intente de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  const accion = async (id: number, url: string, init: RequestInit, ok: string) => {
    setOcupado(id);
    setError(null);
    setAviso(null);
    try {
      const res = await chatFetch(url, init);
      if (!res.ok) {
        setError(await leerError(res, 'No se pudo completar la acción.'));
        return;
      }
      setAviso(ok);
      await Promise.all([cargar(), refrescarCatalogo()]);
    } catch {
      setError('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    } finally {
      setOcupado(null);
    }
  };

  const llenos = (mios?.length ?? 0) >= MAX_MIS_STICKERS;

  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title='Mis stickers'
      size='lg'
      radius='md'
      fullScreen={Boolean(enCelular)}
      centered
      closeButtonProps={{ 'aria-label': 'Cerrar' }}
    >
      <Stack gap='md' data-testid='chat-mis-stickers'>
        {/* Avisos ARRIBA y con color (memoria feedback-ux-feedback-visible). */}
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md' py={8}>
            <Text size='sm'>{error}</Text>
          </Alert>
        )}
        {aviso && (
          <Alert icon={<IconCheck size={16} />} color='green' radius='md' py={8}>
            <Text size='sm'>{aviso}</Text>
          </Alert>
        )}

        <Box className='chat-mis-stickers__nuevo'>
          <Text size='sm' fw={600} mb={4}>
            Agregar un sticker
          </Text>
          <Text size='xs' className='chat-text-muted' mb='sm'>
            Imagen WebP, estática o animada, de hasta 512 KB (ideal 512 × 512 px con fondo transparente).
          </Text>
          <Group align='flex-end' gap='sm' wrap='wrap'>
            <Box className='chat-mis-stickers__vista' aria-live='polite'>
              {vista ? (
                // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
                <img src={vista} alt='Vista previa del sticker' width={88} height={88} />
              ) : (
                <IconPhotoUp size={28} stroke={1.4} />
              )}
            </Box>
            <Stack gap={6} style={{ flex: 1, minWidth: 200 }}>
              <FileButton onChange={escoger} accept='image/webp'>
                {(props) => (
                  <Button {...props} variant='light' size='sm' leftSection={<IconPhotoUp size={16} />} disabled={llenos}>
                    {archivo ? 'Cambiar archivo' : 'Escoger archivo WebP'}
                  </Button>
                )}
              </FileButton>
              <TextInput
                size='sm'
                label='Nombre'
                description='Es lo que leen los asistentes: «[Sticker: …]».'
                placeholder='Por ejemplo: ¡Buen trabajo, equipo!'
                value={nombre}
                maxLength={MAX_NOMBRE_STICKER}
                onChange={(e) => setNombre(e.currentTarget.value)}
                styles={{ input: { fontSize: 16 } }}
              />
            </Stack>
            <Button onClick={() => void guardar()} loading={subiendo} disabled={!archivo || llenos}>
              Guardar
            </Button>
          </Group>
          {llenos && (
            <Text size='xs' c='red' mt={6}>
              Ya tiene {MAX_MIS_STICKERS} stickers propios. Quite alguno para agregar otro.
            </Text>
          )}
        </Box>

        <Box>
          <Group justify='space-between' mb={6}>
            <Text size='sm' fw={600}>
              Sus stickers
            </Text>
            {empresas.length > 0 && (
              <NativeSelect
                size='xs'
                aria-label='Empresa a la que se propone'
                value={empresa}
                onChange={(e) => setEmpresa(e.currentTarget.value)}
                data={empresas.map((e) => ({ value: String(e.id), label: `Proponer a: ${e.nombre}` }))}
                styles={{ input: { fontSize: 16 } }}
              />
            )}
          </Group>
          {mios === null ? (
            <Center py='md'>
              <Loader size='sm' />
            </Center>
          ) : mios.length === 0 ? (
            <Text size='sm' className='chat-text-muted' py='sm'>
              Aún no tiene stickers propios.
            </Text>
          ) : (
            <Stack gap={6}>
              {mios.map((m) => (
                <Group key={m.idSticker} className='chat-mis-stickers__fila' gap='sm' wrap='nowrap'>
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen del propio servidor */}
                  <img src={m.src} alt={m.label} width={56} height={56} loading='lazy' />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size='sm' fw={600} lineClamp={1}>
                      {m.label}
                    </Text>
                    {m.estado && (
                      <Badge size='xs' variant='light' color={COLOR_ESTADO[m.estado]}>
                        {textoEstadoPropuesta(m.estado)}
                        {m.companyName ? ` · ${m.companyName}` : ''}
                      </Badge>
                    )}
                  </Box>
                  {empresas.length > 0 && m.estado !== 'propuesto' && m.estado !== 'aprobado' && (
                    <Button
                      size='compact-sm'
                      variant='light'
                      leftSection={<IconSend size={14} />}
                      loading={ocupado === m.idSticker}
                      onClick={() =>
                        void accion(
                          m.idSticker,
                          `/api/chat/stickers/mios/${m.idSticker}/propuesta`,
                          { method: 'POST', body: JSON.stringify({ idCompany: Number(empresa) }) },
                          'Sticker propuesto a la empresa. Un administrador lo revisará.'
                        )
                      }
                    >
                      Proponer
                    </Button>
                  )}
                  <Button
                    size='compact-sm'
                    variant='subtle'
                    color='red'
                    leftSection={<IconTrash size={14} />}
                    aria-label={`Quitar ${m.label}`}
                    disabled={ocupado === m.idSticker}
                    onClick={() =>
                      void accion(m.idSticker, `/api/chat/stickers/mios/${m.idSticker}`, { method: 'DELETE' }, 'Sticker quitado de «Mis stickers».')
                    }
                  >
                    Quitar
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </Box>

        {puedeRevisar && (
          <Box>
            <Text size='sm' fw={600} mb={6}>
              Propuestas por revisar
            </Text>
            {propuestas === null ? (
              <Center py='md'>
                <Loader size='sm' />
              </Center>
            ) : propuestas.length === 0 ? (
              <Text size='sm' className='chat-text-muted'>
                No hay propuestas pendientes.
              </Text>
            ) : (
              <Stack gap={6}>
                {propuestas.map((p) => (
                  <Group key={p.idSticker} className='chat-mis-stickers__fila' gap='sm' wrap='nowrap'>
                    {/* eslint-disable-next-line @next/next/no-img-element -- imagen del propio servidor */}
                    <img src={p.src} alt={p.label} width={56} height={56} loading='lazy' />
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size='sm' fw={600} lineClamp={1}>
                        {p.label}
                      </Text>
                      <Text size='xs' className='chat-text-muted' lineClamp={1}>
                        {p.autor} · para {p.companyName}
                      </Text>
                    </Box>
                    <Button
                      size='compact-sm'
                      color='green'
                      leftSection={<IconCheck size={14} />}
                      loading={ocupado === p.idSticker}
                      onClick={() =>
                        void accion(
                          p.idSticker,
                          `/api/chat/stickers/propuestas/${p.idSticker}`,
                          { method: 'POST', body: JSON.stringify({ accion: 'aprobar' }) },
                          `«${p.label}» quedó como sticker de ${p.companyName}.`
                        )
                      }
                    >
                      Aprobar
                    </Button>
                    <Button
                      size='compact-sm'
                      variant='subtle'
                      color='red'
                      leftSection={<IconX size={14} />}
                      disabled={ocupado === p.idSticker}
                      onClick={() =>
                        void accion(
                          p.idSticker,
                          `/api/chat/stickers/propuestas/${p.idSticker}`,
                          { method: 'POST', body: JSON.stringify({ accion: 'rechazar' }) },
                          `Propuesta «${p.label}» rechazada.`
                        )
                      }
                    >
                      Rechazar
                    </Button>
                  </Group>
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Stack>
    </Modal>
  );
}
