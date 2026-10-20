'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Drawer,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowBackUp, IconCopy, IconMoodPlus, IconPlus, IconSearch } from '@tabler/icons-react';
import {
  CATEGORIAS_EMOJI,
  REACCIONES_RAPIDAS,
  buscarEmojis,
} from '../../lib/chat/reactions-catalog';
import { describirQuienes, type ChatReactionDto } from '../../lib/chat/media-rules';
import type { ChatMessageDto } from '../../lib/chat/client';

/**
 * REACCIONES del chat (2026-10-20): los chips debajo del mensaje, el botón de
 * reaccionar de escritorio, el selector completo de emojis y la hoja inferior
 * del celular (toque largo sobre el mensaje).
 *
 * Todo con componentes de Mantine y los tokens --app-* del resto del chat
 * (app/globals.css, bloque «Reacciones»): ningún color en duro, así respeta el
 * modo oscuro y las paletas de cada persona.
 */

/* ───────────────────────────── Chips del mensaje ───────────────────────── */

export const FilaReacciones = memo(function FilaReacciones({
  reactions,
  onAlternar,
  deshabilitado = false,
}: {
  reactions: ChatReactionDto[] | undefined;
  onAlternar?: (emoji: string) => void;
  deshabilitado?: boolean;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <Group gap={4} mt={6} className='chat-reacciones' data-testid='chat-reacciones'>
      {reactions.map((r) => (
        <Tooltip key={r.emoji} label={`${describirQuienes(r)} · ${r.emoji}`} withArrow openDelay={300} multiline maw={260}>
          <UnstyledButton
            className={`chat-reaccion${r.mine ? ' chat-reaccion--mia' : ''}`}
            onClick={(e) => {
              // Que el toque no abra la hoja ni cite el mensaje.
              e.stopPropagation();
              onAlternar?.(r.emoji);
            }}
            disabled={deshabilitado || !onAlternar}
            aria-pressed={r.mine}
            aria-label={`${r.emoji} ${r.count}: ${describirQuienes(r)}${r.mine ? '. Toque para quitar su reacción' : '. Toque para reaccionar igual'}`}
          >
            <span className='chat-reaccion__emoji' aria-hidden>
              {r.emoji}
            </span>
            <span className='chat-reaccion__n'>{r.count}</span>
          </UnstyledButton>
        </Tooltip>
      ))}
    </Group>
  );
});

/* ──────────────────────────── Selector de emojis ───────────────────────── */

/** Fila del set rápido. */
function SetRapido({ onElegir, onMas }: { onElegir: (emoji: string) => void; onMas?: () => void }) {
  return (
    <Group gap={2} wrap='nowrap' className='chat-reaccion-rapida' role='group' aria-label='Reacciones rápidas'>
      {REACCIONES_RAPIDAS.map((e) => (
        <UnstyledButton key={e} className='chat-reaccion-rapida__btn' onClick={() => onElegir(e)} aria-label={`Reaccionar con ${e}`}>
          {e}
        </UnstyledButton>
      ))}
      {onMas && (
        <ActionIcon variant='subtle' color='gray' radius='xl' size={36} onClick={onMas} aria-label='Más emojis'>
          <IconPlus size={18} />
        </ActionIcon>
      )}
    </Group>
  );
}

/**
 * El selector COMPLETO: buscador en español y categorías. Sin librería de
 * emojis (pesan cientos de KB): el catálogo es cerrado y es el mismo que
 * valida el servidor (lib/chat/reactions-catalog.ts).
 */
export function SelectorEmoji({ onElegir, alto = 260 }: { onElegir: (emoji: string) => void; alto?: number }) {
  const [consulta, setConsulta] = useState('');
  const encontrados = useMemo(() => buscarEmojis(consulta), [consulta]);
  const boton = (e: string, n: string) => (
    <UnstyledButton key={e} className='chat-emoji-grid__btn' onClick={() => onElegir(e)} aria-label={n} title={n}>
      {e}
    </UnstyledButton>
  );
  return (
    <Stack gap={6} className='chat-emoji-selector'>
      <TextInput
        size='sm'
        placeholder='Buscar emoji (p. ej. gracias)'
        value={consulta}
        onChange={(e) => setConsulta(e.currentTarget.value)}
        leftSection={<IconSearch size={14} />}
        aria-label='Buscar emoji'
        // 16 px: con menos, Safari hace zoom al enfocar (memoria ios-zoom-16px-chat).
        styles={{ input: { fontSize: 16 } }}
      />
      <ScrollArea h={alto} type='auto' offsetScrollbars>
        {consulta.trim() ? (
          encontrados.length > 0 ? (
            <div className='chat-emoji-grid'>{encontrados.map((x) => boton(x.e, x.n))}</div>
          ) : (
            <Text size='xs' className='chat-text-muted' ta='center' py='md'>
              No hay emojis con «{consulta.trim()}».
            </Text>
          )
        ) : (
          CATEGORIAS_EMOJI.map((c) => (
            <Box key={c.id} mb={6}>
              <Text size='xs' fw={600} className='chat-text-muted' mb={2}>
                {c.nombre}
              </Text>
              <div className='chat-emoji-grid'>{c.emojis.map((x) => boton(x.e, x.n))}</div>
            </Box>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
}

/* ─────────────────────── Botón de reaccionar (escritorio) ──────────────── */

/**
 * Aparece al pasar el mouse por el mensaje (CSS `.chat-msg:hover`). En el
 * celular no se muestra: ahí se reacciona con toque largo.
 */
export function BotonReaccionar({ onElegir, alLado }: { onElegir: (emoji: string) => void; alLado: 'left' | 'right' }) {
  const [abierto, setAbierto] = useState(false);
  const [completo, setCompleto] = useState(false);
  const elegir = (e: string) => {
    setAbierto(false);
    setCompleto(false);
    onElegir(e);
  };
  return (
    <Popover
      opened={abierto}
      onChange={(v) => {
        setAbierto(v);
        if (!v) setCompleto(false);
      }}
      position={alLado === 'left' ? 'top-end' : 'top-start'}
      withArrow
      shadow='md'
      radius='md'
      trapFocus
    >
      <Popover.Target>
        <ActionIcon
          variant='subtle'
          color='gray'
          radius='xl'
          size='sm'
          className={`chat-reaccionar-btn${abierto ? ' chat-reaccionar-btn--abierto' : ''}`}
          onClick={() => setAbierto((v) => !v)}
          aria-label='Reaccionar a este mensaje'
        >
          <IconMoodPlus size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={6} maw={340}>
        {completo ? (
          <Box w={300}>
            <SelectorEmoji onElegir={elegir} />
          </Box>
        ) : (
          <SetRapido onElegir={elegir} onMas={() => setCompleto(true)} />
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

/* ─────────────────────── Hoja inferior (celular) ───────────────────────── */

/**
 * Lo que se abre con el TOQUE LARGO sobre un mensaje en el celular: reacciones
 * rápidas (y el selector completo), Responder, Copiar y quién reaccionó.
 *
 * Es UNA sola hoja para todo el hilo (la monta ChatThread): las burbujas en
 * `memo` no cargan un Drawer cada una.
 *
 * Sin Select ni Combobox adentro a propósito: en el celular se cierran solos
 * al mover la página el teclado (memoria gotcha-select-mantine-movil-se-cierra).
 */
export function HojaMensaje({
  mensaje,
  onCerrar,
  onReaccionar,
  onCitar,
  puedeReaccionar,
}: {
  mensaje: ChatMessageDto | null;
  onCerrar: () => void;
  onReaccionar: (mensaje: ChatMessageDto, emoji: string) => void;
  onCitar?: (mensaje: ChatMessageDto) => void;
  puedeReaccionar: boolean;
}) {
  const [completo, setCompleto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // Al levantar el dedo tras el toque largo, algunos navegadores sueltan un
  // «clic» sobre el fondo de la hoja recién abierta y la cerraban al instante.
  // Durante el primer medio segundo, un cierre por el fondo se ignora.
  const abiertaEn = useRef(0);
  const abierta = mensaje !== null;
  useEffect(() => {
    if (abierta) abiertaEn.current = Date.now();
  }, [abierta]);
  const cerrar = () => {
    setCompleto(false);
    setCopiado(false);
    onCerrar();
  };
  const elegir = (e: string) => {
    if (mensaje) onReaccionar(mensaje, e);
    cerrar();
  };
  const texto = mensaje && !mensaje.media ? mensaje.body.trim() : '';
  const reacciones = mensaje?.reactions ?? [];

  return (
    <Drawer
      opened={abierta}
      onClose={() => {
        if (Date.now() - abiertaEn.current < 500) return;
        cerrar();
      }}
      position='bottom'
      size='auto'
      radius='lg'
      withCloseButton={false}
      padding='md'
      classNames={{ content: 'chat-hoja' }}
      aria-label='Acciones del mensaje'
    >
      <Box className='chat-hoja__agarre' aria-hidden />
      <Stack gap='sm' data-testid='chat-hoja-mensaje'>
        {puedeReaccionar &&
          (completo ? (
            <SelectorEmoji onElegir={elegir} alto={280} />
          ) : (
            <SetRapido onElegir={elegir} onMas={() => setCompleto(true)} />
          ))}

        {!completo && (
          <Stack gap={2}>
            {onCitar && mensaje && (
              <UnstyledButton
                className='chat-hoja__accion'
                onClick={() => {
                  onCitar(mensaje);
                  cerrar();
                }}
              >
                <IconArrowBackUp size={18} />
                <Text size='sm'>Responder</Text>
              </UnstyledButton>
            )}
            {texto && (
              <UnstyledButton
                className='chat-hoja__accion'
                onClick={() => {
                  void navigator.clipboard?.writeText(texto).then(
                    () => setCopiado(true),
                    () => setCopiado(false)
                  );
                }}
              >
                <IconCopy size={18} />
                <Text size='sm'>{copiado ? 'Copiado' : 'Copiar texto'}</Text>
              </UnstyledButton>
            )}
          </Stack>
        )}

        {!completo && reacciones.length > 0 && (
          <Box>
            <Text size='xs' fw={600} className='chat-text-muted' mb={4}>
              Reacciones
            </Text>
            <Stack gap={4}>
              {reacciones.map((r) => (
                <Group key={r.emoji} gap='xs' wrap='nowrap' align='flex-start'>
                  <Text size='lg' lh={1}>
                    {r.emoji}
                  </Text>
                  <Text size='sm' style={{ minWidth: 0 }}>
                    {describirQuienes(r)}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Drawer>
  );
}
