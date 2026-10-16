'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Popover } from '@mantine/core';
import { IconChevronRight, IconMessageCircle, IconX } from '@tabler/icons-react';
import type { DraftMark } from '../../../lib/orion/draftBoardDb';
import {
  EASE,
  LIGHT,
  MacAvatar as Avatar,
  MacPill as Pill,
  STATUS_LABEL,
  SYSTEM_BLUE,
  markStyle,
  relativeTime,
  surface,
  useMaterial,
  type Material,
} from './macUi';

export { MARK_STYLE, markStyle } from './macUi';

/** Tarjeta grande de la marca: quién, cuándo, tipo, estado, qué dice, qué debe decir y por qué. */
function MarkCard({
  mark,
  fixed,
  material,
  onDetails,
  onClose,
}: {
  mark: DraftMark;
  fixed: boolean;
  material: Material;
  onDetails: () => void;
  onClose: () => void;
}) {
  const s = markStyle({ fixed, type: mark.type });
  const status = STATUS_LABEL[mark.status] ?? STATUS_LABEL.abierta;
  const author = mark.authorName || mark.authorEmail;
  const when = relativeTime(mark.createdAt);
  const replies = mark.replies?.length ?? 0;
  const label: CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: material.secondary,
    marginBottom: 3,
  };

  return (
    <div style={{ width: 320, color: material.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 14px 10px' }}>
        <Avatar name={author} color={s.solid} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {author}
          </div>
          <div style={{ fontSize: 12, color: material.secondary, marginTop: 2 }}>
            {[when, `en ${mark.createdVersion}`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span
          style={{
            alignSelf: 'flex-start',
            fontSize: 12,
            fontWeight: 700,
            color: s.solid,
            padding: '2px 8px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${s.solid} 12%, transparent)`,
          }}
        >
          #{mark.number}
        </span>
        <button
          type='button'
          aria-label='Cerrar'
          onClick={onClose}
          style={{
            alignSelf: 'flex-start',
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: 0,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: material.well,
            color: material.secondary,
          }}
        >
          <IconX size={12} stroke={2.4} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 12px' }}>
        <Pill label={s.label} color={s.solid} />
        <Pill label={status.label} color={status.color} />
        {mark.autoDetected ? <Pill label='Detectada sola' color={material.secondary} /> : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 14px 14px' }}>
        <div>
          <div style={label}>Dice</div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              padding: '8px 10px',
              borderRadius: 10,
              background: material.well,
              borderLeft: `3px solid ${s.solid}`,
              maxHeight: 150,
              overflowY: 'auto',
              wordBreak: 'break-word',
            }}
          >
            “{mark.quote}”
          </div>
        </div>
        {mark.suggest ? (
          <div>
            <div style={label}>Debe decir</div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                fontWeight: 500,
                color: '#0d9460',
                maxHeight: 110,
                overflowY: 'auto',
                wordBreak: 'break-word',
              }}
            >
              “{mark.suggest}”
            </div>
          </div>
        ) : null}
        {mark.why ? (
          <div>
            <div style={label}>{mark.type === 'pregunta' ? 'Pregunta' : 'Por qué'}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', wordBreak: 'break-word' }}>
              {mark.why}
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderTop: `0.5px solid ${material.hairline}`,
          fontSize: 13,
        }}
      >
        <IconMessageCircle size={16} stroke={1.8} color={material.secondary} />
        <span style={{ color: material.secondary }}>
          {replies === 0 ? 'Sin respuestas' : replies === 1 ? '1 respuesta' : `${replies} respuestas`}
        </span>
        <button
          type='button'
          onClick={onDetails}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            height: 30,
            padding: '0 10px 0 12px',
            border: 0,
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            background: SYSTEM_BLUE,
          }}
        >
          Ver detalles
          <IconChevronRight size={15} stroke={2.2} />
        </button>
      </div>
    </div>
  );
}

/**
 * Burbuja de una marca del tablero: píldora compacta (avatar de quien la hizo + número). Al
 * pasar el mouse se asoma la tarjeta; al hacer clic (o recién creada) queda abierta hasta que se
 * cierra con la X, Esc o un clic afuera. "Ver detalles" abre la marca completa en el panel.
 * `onPaper`: va sobre la hoja blanca del Word (siempre en material claro).
 */
export default function DraftMarkBubble({
  mark,
  fixed,
  open,
  onPaper = false,
  size = 'md',
  style,
  onOpen,
  onClose,
  onDetails,
}: {
  mark: DraftMark;
  fixed: boolean;
  /** Abierta desde el tablero (clic en la píldora o recién creada). */
  open: boolean;
  onPaper?: boolean;
  size?: 'sm' | 'md';
  style?: CSSProperties;
  onOpen: () => void;
  onClose: () => void;
  onDetails: () => void;
}) {
  const cardMaterial = useMaterial();
  const pillMaterial = onPaper ? LIGHT : cardMaterial;
  const [hover, setHover] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const pillRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = markStyle({ fixed, type: mark.type });
  const author = mark.authorName || mark.authorEmail;
  const height = size === 'sm' ? 22 : 26;
  const opened = hover || open;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const close = () => {
    window.clearTimeout(closeTimer.current);
    setHover(false);
    if (open) onClose();
  };

  // Clic fuera de la píldora y de la tarjeta: se cierra.
  useEffect(() => {
    if (!opened) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (pillRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      window.clearTimeout(closeTimer.current);
      setHover(false);
      if (open) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [opened, open, onClose]);

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setHover(true);
  };
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(false), 160);
  };

  return (
    <Popover
      opened={opened}
      onClose={close}
      position='bottom-start'
      offset={8}
      withArrow
      arrowSize={12}
      arrowOffset={18}
      arrowRadius={2}
      zIndex={300}
      withinPortal
      closeOnEscape
      closeOnClickOutside={false}
      transitionProps={{ transition: 'pop-top-left', duration: 180, timingFunction: EASE }}
      middlewares={{ flip: true, shift: { padding: 12 } }}
      styles={{
        dropdown: {
          ...surface(cardMaterial),
          padding: 0,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,.28), 0 4px 14px rgba(0,0,0,.12)',
        },
        arrow: { background: cardMaterial.bg },
      }}
    >
      <Popover.Target>
        <button
          ref={pillRef}
          type='button'
          data-mark-bubble={mark.id}
          onClick={onOpen}
          onMouseEnter={enter}
          onMouseLeave={leave}
          aria-label={`Marca ${mark.number}: ${s.label} de ${author}`}
          aria-expanded={opened}
          style={{
            ...surface(pillMaterial),
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height,
            padding: size === 'sm' ? '0 7px 0 2px' : '0 9px 0 3px',
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'var(--mantine-font-family)',
            fontSize: size === 'sm' ? 11 : 12,
            fontWeight: 650,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            color: s.solid,
            userSelect: 'none',
            verticalAlign: 'middle',
            boxShadow: opened
              ? `0 0 0 3px color-mix(in srgb, ${s.solid} 28%, transparent), 0 6px 16px rgba(0,0,0,.20)`
              : '0 2px 8px rgba(0,0,0,.16), 0 0 0 0.5px rgba(0,0,0,.04)',
            transform: opened ? 'scale(1.06)' : 'scale(1)',
            transition: `transform .18s ${EASE}, box-shadow .18s ${EASE}`,
            ...style,
          }}
        >
          <Avatar name={author} color={s.solid} size={height - 6} />
          {mark.number}
        </button>
      </Popover.Target>
      <Popover.Dropdown ref={cardRef} onMouseEnter={enter} onMouseLeave={leave}>
        <MarkCard
          mark={mark}
          fixed={fixed}
          material={cardMaterial}
          onDetails={() => {
            close();
            onDetails();
          }}
          onClose={close}
        />
      </Popover.Dropdown>
    </Popover>
  );
}
