'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import {
  Alert,
  Box,
  Button,
  Center,
  Drawer,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconMovie, IconSearch, IconSticker } from '@tabler/icons-react';
import { chatGetJson, isAbortError } from '../../lib/chat/client';
import type { MediaParaEnviar } from './useChatConversation';

/**
 * SELECTOR de stickers y GIF del chat (2026-10-20).
 *
 * En el celular es una HOJA INFERIOR (Drawer abajo), como el resto de las
 * acciones del chat en pantalla chica; en escritorio, un Modal como el de
 * «Multimedia y archivos» (ChatMediaPanel). Se carga solo al abrirse: nada de
 * sondeo.
 *
 * La pestaña de GIF solo aparece si el servidor tiene llave de GIPHY
 * (`gif: true` en /api/chat/stickers). Las imágenes de GIF llegan por el proxy
 * firmado de SynerLink: el navegador nunca habla con GIPHY.
 */

type StickerItem = {
  key: string;
  provider: 'gss' | 'empresa';
  code?: string;
  idSticker?: number;
  label: string;
  keywords: string;
  src: string;
};
type Catalogo = { gif: boolean; stickers: StickerItem[] };
type GifItem = { id: string; title: string; width: number | null; height: number | null; previewUrl: string };
type PaginaGif = { items: GifItem[]; next: number | null };

// Catálogo en memoria de la pestaña: abrir el selector dos veces no pide dos veces.
let catalogoEnCache: Catalogo | null = null;
let catalogoEnCurso: Promise<Catalogo | null> | null = null;

function pedirCatalogo(): Promise<Catalogo | null> {
  if (catalogoEnCache) return Promise.resolve(catalogoEnCache);
  if (!catalogoEnCurso) {
    catalogoEnCurso = chatGetJson<Catalogo>('/api/chat/stickers')
      .then((data) => {
        if (data) catalogoEnCache = data;
        return data;
      })
      .catch(() => null)
      .finally(() => {
        catalogoEnCurso = null;
      });
  }
  return catalogoEnCurso;
}

/**
 * ¿Hay GIF? Para el texto del menú del clip («Stickers» o «Stickers y GIF»).
 * UNA petición por pestaña del navegador (queda en memoria), nunca un sondeo.
 */
export function useGifDisponible(activo: boolean): boolean {
  const [gif, setGif] = useState(Boolean(catalogoEnCache?.gif));
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    void pedirCatalogo().then((c) => vivo && setGif(Boolean(c?.gif)));
    return () => {
      vivo = false;
    };
  }, [activo]);
  return gif;
}

export default function ChatMediaPicker({
  abierto,
  onCerrar,
  onEnviar,
  pestanaInicial = 'stickers',
}: {
  abierto: boolean;
  onCerrar: () => void;
  onEnviar: (media: MediaParaEnviar) => void;
  pestanaInicial?: 'stickers' | 'gif';
}) {
  const enCelular = useMediaQuery('(max-width: 768px)');
  const [catalogo, setCatalogo] = useState<Catalogo | null>(catalogoEnCache);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const [pestana, setPestana] = useState<string>(pestanaInicial);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (!abierto || catalogo) return;
    let vivo = true;
    setErrorCatalogo(null);
    void pedirCatalogo().then((data) => {
      if (!vivo) return;
      if (!data) {
        setErrorCatalogo('No se pudieron cargar los stickers.');
        return;
      }
      setCatalogo(data);
    });
    return () => {
      vivo = false;
    };
  }, [abierto, catalogo]);

  useEffect(() => {
    if (abierto) setPestana(pestanaInicial);
  }, [abierto, pestanaInicial]);

  const stickers = useMemo(() => {
    const q = filtro.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const lista = catalogo?.stickers ?? [];
    if (!q) return lista;
    return lista.filter((s) =>
      `${s.label} ${s.keywords}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q)
    );
  }, [catalogo, filtro]);

  const enviarSticker = (s: StickerItem) => {
    if (s.provider === 'gss' && s.code) onEnviar({ kind: 'sticker', code: s.code });
    else if (s.provider === 'empresa' && s.idSticker) onEnviar({ kind: 'sticker', idSticker: s.idSticker });
  };

  const conGif = Boolean(catalogo?.gif);
  const altoLista = enCelular ? 'min(52dvh, 420px)' : 380;

  const contenido = (
    <Stack gap='sm' data-testid='chat-media-picker'>
      {errorCatalogo && (
        <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md' py={6}>
          <Text size='xs'>{errorCatalogo}</Text>
        </Alert>
      )}
      <Tabs value={conGif ? pestana : 'stickers'} onChange={(v) => setPestana(v ?? 'stickers')} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value='stickers' leftSection={<IconSticker size={16} />}>
            Stickers
          </Tabs.Tab>
          {conGif && (
            <Tabs.Tab value='gif' leftSection={<IconMovie size={16} />}>
              GIF
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value='stickers' pt='sm'>
          <Stack gap='xs'>
            <TextInput
              size='sm'
              placeholder='Buscar sticker'
              value={filtro}
              onChange={(e) => setFiltro(e.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
              aria-label='Buscar sticker'
              styles={{ input: { fontSize: 16 } }}
            />
            <ScrollArea h={altoLista} type='auto' offsetScrollbars>
              {!catalogo && !errorCatalogo ? (
                <Center py='xl'>
                  <Loader size='sm' />
                </Center>
              ) : stickers.length === 0 ? (
                <Text size='xs' ta='center' className='chat-text-muted' py='md'>
                  No hay stickers con ese nombre.
                </Text>
              ) : (
                <div className='chat-sticker-grid'>
                  {stickers.map((s) => (
                    <UnstyledButton
                      key={s.key}
                      className='chat-sticker-grid__btn'
                      onClick={() => enviarSticker(s)}
                      aria-label={`Enviar sticker ${s.label}`}
                      title={s.label}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagen local o del propio servidor */}
                      <img src={s.src} alt={s.label} loading='lazy' width={88} height={88} />
                    </UnstyledButton>
                  ))}
                </div>
              )}
            </ScrollArea>
          </Stack>
        </Tabs.Panel>

        {conGif && (
          <Tabs.Panel value='gif' pt='sm'>
            <PestanaGif alto={altoLista} onElegir={(id) => onEnviar({ kind: 'gif', id })} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );

  if (enCelular) {
    return (
      <Drawer
        opened={abierto}
        onClose={onCerrar}
        position='bottom'
        size='auto'
        radius='lg'
        padding='md'
        title={conGif ? 'Stickers y GIF' : 'Stickers'}
        classNames={{ content: 'chat-hoja' }}
        closeButtonProps={{ 'aria-label': 'Cerrar' }}
      >
        {contenido}
      </Drawer>
    );
  }
  return (
    <Modal
      opened={abierto}
      onClose={onCerrar}
      title={conGif ? 'Stickers y GIF' : 'Stickers'}
      size='lg'
      radius='md'
      centered
      closeButtonProps={{ 'aria-label': 'Cerrar' }}
    >
      {contenido}
    </Modal>
  );
}

/** Pestaña de GIF: populares al abrir y búsqueda con espera de 350 ms. */
function PestanaGif({ alto, onElegir }: { alto: number | string; onElegir: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [siguiente, setSiguiente] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async (consulta: string, offset: number) => {
    abortRef.current?.abort();
    const control = new AbortController();
    abortRef.current = control;
    setCargando(true);
    setError(null);
    try {
      const data = await chatGetJson<PaginaGif>(
        `/api/chat/gifs/search?q=${encodeURIComponent(consulta)}&offset=${offset}`,
        control.signal
      );
      if (control.signal.aborted) return;
      if (!data) {
        setError('El servicio de GIF no respondió. Intente de nuevo.');
        return;
      }
      setItems((prev) => (offset > 0 ? [...prev, ...data.items] : data.items));
      setSiguiente(data.next);
    } catch (err) {
      if (!isAbortError(err)) setError('El servicio de GIF no respondió. Intente de nuevo.');
    } finally {
      if (!control.signal.aborted) setCargando(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void cargar(q.trim(), 0), q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [q, cargar]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <Stack gap='xs'>
      <TextInput
        size='sm'
        placeholder='Buscar en GIPHY'
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        aria-label='Buscar GIF'
        styles={{ input: { fontSize: 16 } }}
      />
      {error && (
        <Text size='xs' c='red'>
          {error}
        </Text>
      )}
      <ScrollArea h={alto} type='auto' offsetScrollbars>
        {items.length === 0 && cargando ? (
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        ) : items.length === 0 ? (
          <Text size='xs' ta='center' className='chat-text-muted' py='md'>
            No se encontraron GIF.
          </Text>
        ) : (
          <>
            <div className='chat-gif-grid'>
              {items.map((g) => (
                <UnstyledButton
                  key={g.id}
                  className='chat-gif-grid__btn'
                  onClick={() => onElegir(g.id)}
                  aria-label={`Enviar GIF ${g.title}`}
                  title={g.title}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- pasa por el proxy firmado */}
                  <img src={g.previewUrl} alt={g.title} loading='lazy' />
                </UnstyledButton>
              ))}
            </div>
            {siguiente !== null && (
              <Center mt='xs'>
                <Button size='xs' variant='subtle' loading={cargando} onClick={() => void cargar(q.trim(), siguiente)}>
                  Cargar más
                </Button>
              </Center>
            )}
          </>
        )}
      </ScrollArea>
      {/* GIPHY exige la atribución en el buscador. */}
      <Box ta='right'>
        <Text size='xs' className='chat-text-muted'>
          Con tecnología de GIPHY · con filtro de contenido
        </Text>
      </Box>
    </Stack>
  );
}
