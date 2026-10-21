'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Center, Loader, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { chatGetJson, isAbortError } from '../../lib/chat/client';

/**
 * Piezas compartidas del selector de stickers y GIF del chat (2026-10-20).
 *
 * El selector en sí vive ahora en ChatExpresiones (panel Emoji | Stickers |
 * GIF con botón propio al lado del clip, como Telegram y WhatsApp — pedido de
 * Nicolás, 2026-10-20 12:16). Aquí quedan el catálogo (UNA petición por
 * pestaña del navegador, nunca un sondeo) y la pestaña de GIF.
 *
 * La pestaña de GIF solo aparece si el servidor tiene llave de GIPHY
 * (`gif: true` en /api/chat/stickers). Las imágenes de GIF llegan por el proxy
 * firmado de SynerLink: el navegador nunca habla con GIPHY.
 */

export type StickerItem = {
  key: string;
  provider: 'gss' | 'empresa';
  /** Paquete: 'mios' (Mis stickers, 2026-10-21), 'animados' (Noto), 'gss' (estático) o 'empresa'. */
  pack?: 'mios' | 'animados' | 'gss' | 'empresa';
  code?: string;
  idSticker?: number;
  label: string;
  keywords: string;
  src: string;
  animated?: boolean;
  poster?: string | null;
};
export type PaqueteItem = { id: 'mios' | 'animados' | 'gss' | 'empresa'; nombre: string };
export type Catalogo = {
  gif: boolean;
  packs?: PaqueteItem[];
  stickers: StickerItem[];
  /** «Mis stickers» está disponible (la tabla existe en esta base). */
  misStickers?: boolean;
  /** Empresas a las que se puede proponer un sticker propio. */
  empresas?: { id: number; nombre: string }[];
  /** Quien mira revisa propuestas (administrador). Solo pinta; la reja está en la ruta. */
  puedeRevisar?: boolean;
};
type GifItem = { id: string; title: string; width: number | null; height: number | null; previewUrl: string };
type PaginaGif = { items: GifItem[]; next: number | null };

// Catálogo en memoria de la pestaña: abrir el selector dos veces no pide dos veces.
let catalogoEnCache: Catalogo | null = null;
let catalogoEnCurso: Promise<Catalogo | null> | null = null;

export function pedirCatalogo(): Promise<Catalogo | null> {
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

// Quienes pintan el catálogo y quieren enterarse cuando cambia (al cargar o
// quitar un sticker propio).
const suscritos = new Set<(c: Catalogo | null) => void>();

/** Escucha los cambios del catálogo. Devuelve cómo dejar de escuchar. */
export function suscribirCatalogo(fn: (c: Catalogo | null) => void): () => void {
  suscritos.add(fn);
  return () => {
    suscritos.delete(fn);
  };
}

/** Vuelve a pedir el catálogo (después de cargar, quitar o proponer un sticker propio). */
export async function refrescarCatalogo(): Promise<Catalogo | null> {
  catalogoEnCache = null;
  const c = await pedirCatalogo();
  for (const fn of suscritos) fn(c);
  return c;
}

/** El catálogo si ya se pidió en esta pestaña (para pintar sin esperar). */
export function catalogoEnMemoria(): Catalogo | null {
  return catalogoEnCache;
}

/**
 * ¿Hay GIF? Decide si el panel muestra la pestaña de GIF.
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

/** Pestaña de GIF: populares al abrir y búsqueda con espera de 350 ms. */
export function PestanaGif({ alto, onElegir }: { alto: number | string; onElegir: (id: string) => void }) {
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
