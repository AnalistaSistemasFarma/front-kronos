'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Center, Group, Loader, ScrollArea, Stack, Tabs, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAlertCircle, IconMoodSmile, IconMovie, IconPlus, IconSearch, IconSettings, IconSticker } from '@tabler/icons-react';
import { SelectorEmoji } from './ChatReactions';
import { PestanaGif, catalogoEnMemoria, pedirCatalogo, suscribirCatalogo, type Catalogo, type StickerItem } from './ChatMediaPicker';
import StickerAnimado from './StickerAnimado';
import type { MediaParaEnviar } from './useChatConversation';
import { ATRIBUCION_STICKERS_ANIMADOS } from '../../lib/chat/stickers-animados-catalog';

/**
 * PANEL de expresiones del chat: Emoji | Stickers | GIF (2026-10-20).
 *
 * Pedido de Nicolás (2026-10-20, 12:16), mirando cómo lo hacen Telegram y
 * WhatsApp: un botón PROPIO al lado del clip —no una opción escondida dentro
 * del menú del clip— que abre un panel con pestañas. Lo abre el compositor
 * (ChatComposer):
 *   - en ESCRITORIO, como un globo encima de la caja de escribir (Popover);
 *   - en el CELULAR, como una hoja inferior DENTRO del compositor que ocupa el
 *     lugar del teclado (el teclado se cierra al abrirla y el botón cambia a
 *     «teclado» para volver), igual que en esas dos apps.
 *
 * - Emoji: el mismo catálogo cerrado de las reacciones (sin librería); el
 *   emoji se inserta en el texto donde está el cursor.
 * - Stickers: varios PAQUETES (barra de paquetes arriba, como Telegram):
 *   animados de Noto (WebP, CC BY 4.0), el estático propio de GSS y, si hay,
 *   los de la empresa. Los animados se mueven SOLO mientras se ven
 *   (StickerAnimado) y nunca con prefers-reduced-motion.
 * - GIF: solo si el servidor tiene llave (si no, la pestaña no aparece).
 */

type Pestana = 'emoji' | 'stickers' | 'gif';

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function ChatExpresiones({
  alto,
  onEmoji,
  onEnviar,
  onMisStickers,
}: {
  /** Alto de la zona desplazable (número en px o una expresión CSS). */
  alto: number | string;
  onEmoji: (emoji: string) => void;
  onEnviar: (media: MediaParaEnviar) => void;
  /** Abre «Mis stickers» (cargar, quitar, proponer). Lo maneja el compositor. */
  onMisStickers?: () => void;
}) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(catalogoEnMemoria());
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('stickers');

  useEffect(() => {
    if (catalogo) return;
    let vivo = true;
    void pedirCatalogo().then((data) => {
      if (!vivo) return;
      if (!data) setErrorCatalogo('No se pudieron cargar los stickers.');
      else setCatalogo(data);
    });
    return () => {
      vivo = false;
    };
  }, [catalogo]);

  // Al cargar o quitar un sticker propio, el catálogo se vuelve a pedir.
  useEffect(() => suscribirCatalogo((c) => c && setCatalogo(c)), []);

  const conGif = Boolean(catalogo?.gif);
  const valor: Pestana = pestana === 'gif' && !conGif ? 'stickers' : pestana;

  return (
    <Box className='chat-expresiones' data-testid='chat-expresiones'>
      {errorCatalogo && (
        <Alert icon={<IconAlertCircle size={16} />} color='red' radius='md' py={6} mb='xs'>
          <Text size='xs'>{errorCatalogo}</Text>
        </Alert>
      )}
      <Tabs value={valor} onChange={(v) => setPestana((v as Pestana) ?? 'stickers')} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value='emoji' leftSection={<IconMoodSmile size={16} />}>
            Emoji
          </Tabs.Tab>
          <Tabs.Tab value='stickers' leftSection={<IconSticker size={16} />}>
            Stickers
          </Tabs.Tab>
          {conGif && (
            <Tabs.Tab value='gif' leftSection={<IconMovie size={16} />}>
              GIF
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value='emoji' pt='xs'>
          <SelectorEmoji onElegir={onEmoji} alto={alto} />
        </Tabs.Panel>

        <Tabs.Panel value='stickers' pt='xs'>
          <PestanaStickers
            catalogo={catalogo}
            error={Boolean(errorCatalogo)}
            alto={alto}
            onEnviar={onEnviar}
            onMisStickers={onMisStickers}
          />
        </Tabs.Panel>

        {conGif && (
          <Tabs.Panel value='gif' pt='xs'>
            <PestanaGif alto={alto} onElegir={(id) => onEnviar({ kind: 'gif', id })} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Box>
  );
}

export default memo(ChatExpresiones);

/** Vista de un sticker en la cuadrícula: animado (si se ve) o estático. */
function MiniaturaSticker({ s }: { s: StickerItem }) {
  if (s.animated && s.poster) {
    return <StickerAnimado src={s.src} poster={s.poster} alt={s.label} size={72} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- imagen local o del propio servidor
  return <img src={s.src} alt={s.label} loading='lazy' width={72} height={72} />;
}

function PestanaStickers({
  catalogo,
  error,
  alto,
  onEnviar,
  onMisStickers,
}: {
  catalogo: Catalogo | null;
  error: boolean;
  alto: number | string;
  onEnviar: (media: MediaParaEnviar) => void;
  onMisStickers?: () => void;
}) {
  const [filtro, setFiltro] = useState('');
  const viewport = useRef<HTMLDivElement>(null);

  const paquetes = useMemo(() => {
    if (!catalogo) return [];
    const declarados = catalogo.packs ?? [
      { id: 'gss' as const, nombre: 'GSS' },
      { id: 'empresa' as const, nombre: 'De la empresa' },
    ];
    return declarados
      .map((p) => ({ ...p, stickers: catalogo.stickers.filter((s) => (s.pack ?? (s.provider === 'empresa' ? 'empresa' : 'gss')) === p.id) }))
      // «Mis stickers» se muestra aunque esté vacío: ahí está el botón de agregar.
      .filter((p) => p.stickers.length > 0 || (p.id === 'mios' && Boolean(onMisStickers)));
  }, [catalogo, onMisStickers]);

  const encontrados = useMemo(() => {
    const q = normalizar(filtro);
    if (!q || !catalogo) return null;
    return catalogo.stickers.filter((s) => normalizar(`${s.label} ${s.keywords}`).includes(q));
  }, [catalogo, filtro]);

  const enviar = (s: StickerItem) => {
    if (s.provider === 'gss' && s.code) onEnviar({ kind: 'sticker', code: s.code });
    else if (s.provider === 'empresa' && s.idSticker) onEnviar({ kind: 'sticker', idSticker: s.idSticker });
  };

  const irAPaquete = (id: string) => {
    const destino = viewport.current?.querySelector<HTMLElement>(`[data-paquete='${id}']`);
    if (destino && viewport.current) viewport.current.scrollTo({ top: destino.offsetTop - 4, behavior: 'smooth' });
  };

  const cuadricula = (lista: StickerItem[], conAgregar = false) => (
    <div className='chat-sticker-grid'>
      {conAgregar && onMisStickers && (
        <UnstyledButton
          className='chat-sticker-grid__btn chat-sticker-grid__agregar'
          onClick={onMisStickers}
          aria-label='Agregar un sticker propio'
          title='Agregar un sticker propio'
        >
          <IconPlus size={26} stroke={1.5} />
          <span>Agregar</span>
        </UnstyledButton>
      )}
      {lista.map((s) => (
        <UnstyledButton
          key={s.key}
          className='chat-sticker-grid__btn'
          onClick={() => enviar(s)}
          aria-label={`Enviar sticker ${s.label}`}
          title={s.label}
        >
          <MiniaturaSticker s={s} />
        </UnstyledButton>
      ))}
    </div>
  );

  const hayAnimados = paquetes.some((p) => p.id === 'animados');

  return (
    <Stack gap='xs'>
      <TextInput
        size='sm'
        placeholder='Buscar sticker'
        value={filtro}
        onChange={(e) => setFiltro(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        aria-label='Buscar sticker'
        // 16 px: con menos, Safari hace zoom al enfocar.
        styles={{ input: { fontSize: 16 } }}
      />
      {paquetes.length > 1 && !encontrados && (
        <div className='chat-paquetes' role='toolbar' aria-label='Paquetes de stickers'>
          {paquetes.map((p) => {
            const portada = p.stickers[0];
            return (
              <Tooltip key={p.id} label={p.nombre} withArrow openDelay={300}>
                <UnstyledButton className='chat-paquetes__btn' onClick={() => irAPaquete(p.id)} aria-label={`Paquete ${p.nombre}`}>
                  {portada ? (
                    // eslint-disable-next-line @next/next/no-img-element -- portada local o del propio servidor
                    <img src={portada.poster ?? portada.src} alt='' width={28} height={28} />
                  ) : (
                    <IconSticker size={20} stroke={1.5} />
                  )}
                  <span>{p.nombre}</span>
                </UnstyledButton>
              </Tooltip>
            );
          })}
        </div>
      )}
      <ScrollArea h={alto} type='auto' offsetScrollbars viewportRef={viewport}>
        {!catalogo && !error ? (
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        ) : encontrados ? (
          encontrados.length === 0 ? (
            <Text size='xs' ta='center' className='chat-text-muted' py='md'>
              No hay stickers con ese nombre.
            </Text>
          ) : (
            cuadricula(encontrados)
          )
        ) : (
          paquetes.map((p) => (
            <Box key={p.id} data-paquete={p.id} mb='xs' pos='relative'>
              <Group justify='space-between' gap={4} mb={4} wrap='nowrap'>
                <Text size='xs' fw={600} className='chat-text-muted'>
                  {p.nombre}
                </Text>
                {p.id === 'mios' && onMisStickers && (
                  <Button size='compact-xs' variant='subtle' leftSection={<IconSettings size={12} />} onClick={onMisStickers}>
                    Gestionar
                  </Button>
                )}
              </Group>
              {cuadricula(p.stickers, p.id === 'mios')}
            </Box>
          ))
        )}
        {/* CC BY 4.0 exige la atribución donde se muestran. */}
        {hayAnimados && (
          <Text size='xs' className='chat-text-muted chat-expresiones__credito' ta='center' mt='xs'>
            {ATRIBUCION_STICKERS_ANIMADOS}
          </Text>
        )}
      </ScrollArea>
    </Stack>
  );
}
