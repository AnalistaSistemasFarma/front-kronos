'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Menu,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronDown,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  VALENTINE_CATEGORIES,
  VALENTINE_MESSAGE_MAX,
  VALENTINE_REACTIONS,
  VALENTINE_TAGLINE,
  VALENTINE_TO_NAME_MAX,
  resolveValentineCompanyLogoSrc,
  type ValentineCategoryId,
} from '../../lib/valentine/constants';

export type ValentinePost = {
  id: number;
  message: string;
  categoryId: string;
  toName?: string | null;
  createdAt: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

type Props = {
  posts: ValentinePost[];
  loading: boolean;
  posting: boolean;
  freshPostId?: number | null;
  canModerate?: boolean;
  companyName?: string;
  companyLogo?: string | null;
  companyId?: number | null;
  companies?: Array<{
    idCompany: number;
    companyName: string;
    companyLogo?: string | null;
  }>;
  onCompanyChange?: (idCompany: number) => void;
  onClose: () => void;
  onSubmit: (payload: {
    message: string;
    categoryId: ValentineCategoryId;
    toName?: string | null;
  }) => Promise<void>;
  onReact: (postId: number, emoji: string) => Promise<void>;
  onDelete?: (postId: number) => Promise<void>;
};

const BOARD_W = 2800;
const BOARD_H = 1800;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;

function categoryLabel(id: string) {
  return VALENTINE_CATEGORIES.find((c) => c.id === id)?.label || id;
}

function categoryEmoji(id: string) {
  return VALENTINE_CATEGORIES.find((c) => c.id === id)?.emoji || '💕';
}

function noteLayout(id: number, index: number) {
  const seed = Math.abs((id * 2654435761) ^ (index * 9749));
  const col = index % 8;
  const row = Math.floor(index / 8);
  const baseX = 120 + col * 300 + (seed % 80);
  const baseY = 140 + row * 280 + ((seed >> 3) % 90);
  const x = Math.min(BOARD_W - 260, Math.max(60, baseX));
  const y = Math.min(BOARD_H - 220, Math.max(100, baseY));
  const tilt = ((seed % 11) - 5) * 1.2;
  const shade = 1 + (seed % 3);
  return { x, y, tilt, shade };
}

function CompanyLogoMark({
  src,
  name,
  size = 'md',
  fallback = 'name',
}: {
  src: string | null;
  name: string;
  size?: 'sm' | 'md' | 'option';
  fallback?: 'name' | 'empty';
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    if (fallback === 'empty') {
      return <span className='vw-company-logo-slot' aria-hidden />;
    }
    return (
      <span className='vw-company-logo-fallback' title={name}>
        {name || '—'}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || 'Logo empresa'}
      className={`vw-company-logo vw-company-logo--${size}`}
      onError={() => setBroken(true)}
      draggable={false}
    />
  );
}

export default function ValentineWallBoard({
  posts,
  loading,
  posting,
  freshPostId = null,
  canModerate = false,
  companyName = '',
  companyLogo = null,
  companyId = null,
  companies = [],
  onCompanyChange,
  onClose,
  onSubmit,
  onReact,
  onDelete,
}: Props) {
  const [categoryId, setCategoryId] = useState<ValentineCategoryId>(
    VALENTINE_CATEGORIES[0].id
  );
  const [message, setMessage] = useState('');
  const [toName, setToName] = useState('');
  const [reactingId, setReactingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 820px)').matches : false
  );
  const [composerOpen, setComposerOpen] = useState(() =>
    typeof window !== 'undefined'
      ? !window.matchMedia('(max-width: 820px)').matches
      : true
  );
  const [zoomLabel, setZoomLabel] = useState(65);
  const [dragging, setDragging] = useState(false);
  const [revealDone, setRevealDone] = useState(false);

  // Móvil: solo tablero O solo escribir (nunca ambos a la vez).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) setComposerOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const showComposer = composerOpen;
  const showBoard = !isMobile || !composerOpen;

  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(0.65);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );
  const rafRef = useRef(0);

  const catMeta = useMemo(
    () => VALENTINE_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId]
  );

  const canSend =
    message.trim().length > 0 &&
    message.trim().length <= VALENTINE_MESSAGE_MAX &&
    !posting;

  const applyTransform = useCallback(() => {
    const el = planeRef.current;
    if (!el) return;
    const { x, y } = panRef.current;
    const z = zoomRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
  }, []);

  const scheduleTransform = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      applyTransform();
    });
  }, [applyTransform]);

  const setZoomClamped = (next: number) => {
    zoomRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    setZoomLabel(Math.round(zoomRef.current * 100));
    scheduleTransform();
  };

  const resetView = () => {
    zoomRef.current = 0.65;
    panRef.current = { x: 0, y: 0 };
    setZoomLabel(65);
    applyTransform();
  };

  useEffect(() => {
    applyTransform();
  }, [applyTransform, expanded, composerOpen]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? -0.06 : 0.06;
        zoomRef.current = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, zoomRef.current + delta)
        );
        setZoomLabel(Math.round(zoomRef.current * 100));
      } else {
        panRef.current = {
          x: panRef.current.x - e.deltaX,
          y: panRef.current.y - e.deltaY,
        };
      }
      scheduleTransform();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scheduleTransform]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    type PinchState = {
      dist: number;
      zoom: number;
    };
    let pinch: PinchState | null = null;

    const touchDist = (a: Touch, b: Touch) =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      dragRef.current = null;
      setDragging(false);
      pinch = {
        dist: Math.max(1, touchDist(e.touches[0], e.touches[1])),
        zoom: zoomRef.current,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const d = Math.max(1, touchDist(e.touches[0], e.touches[1]));
      const next = pinch.zoom * (d / pinch.dist);
      zoomRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      setZoomLabel(Math.round(zoomRef.current * 100));
      scheduleTransform();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scheduleTransform]);

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest(
        '.vw-note__reacts, .vw-react-btn, .vw-note__delete, .vw-cork-ui, button, a, input, textarea'
      )
    ) {
      return;
    }
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    panRef.current = {
      x: dragRef.current.panX + (e.clientX - dragRef.current.x),
      y: dragRef.current.panY + (e.clientY - dragRef.current.y),
    };
    scheduleTransform();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const shellClass = [
    'vw-board-shell',
    'vw-board-shell--blush',
    'vw-board-shell--expanded',
    revealDone ? 'vw-board-shell--settled' : 'vw-board-shell--emerge',
    isMobile && composerOpen ? 'vw-board-shell--writing' : '',
    isMobile && !composerOpen ? 'vw-board-shell--board-only' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={shellClass}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.animationName.includes('vw-board-emerge')) {
          setRevealDone(true);
        }
      }}
    >
      <div className='vw-board-edge vw-board-edge--top' aria-hidden />
      <div className='vw-board-edge vw-board-edge--bottom' aria-hidden />

      <header className='vw-board-header vw-cork-ui'>
        {companies.length > 1 && onCompanyChange ? (
          <div className='vw-header-company vw-header-company--logo vw-header-company--switch'>
            <Menu
              withinPortal
              zIndex={10050}
              position='bottom'
              shadow='md'
              radius='md'
              width={260}
            >
              <Menu.Target>
                <UnstyledButton
                  className='vw-company-switch-btn'
                  aria-label={
                    companyName
                      ? `Cambiar tablero · ${companyName}`
                      : 'Cambiar tablero de empresa'
                  }
                >
                  <CompanyLogoMark
                    key={companyLogo ?? companyName ?? 'none'}
                    src={resolveValentineCompanyLogoSrc(
                      companyLogo ??
                        companies.find((c) => c.idCompany === companyId)
                          ?.companyLogo
                    )}
                    name={companyName}
                    size='md'
                  />
                  <IconChevronDown
                    size={16}
                    stroke={2}
                    className='vw-company-switch-chevron'
                    aria-hidden
                  />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown className='vw-company-switch-menu'>
                {companies.map((c) => {
                  const active = c.idCompany === companyId;
                  return (
                    <Menu.Item
                      key={c.idCompany}
                      onClick={() => onCompanyChange(c.idCompany)}
                      leftSection={
                        <CompanyLogoMark
                          src={resolveValentineCompanyLogoSrc(c.companyLogo)}
                          name={c.companyName}
                          size='option'
                          fallback='empty'
                        />
                      }
                      className={
                        active ? 'vw-company-switch-item--active' : undefined
                      }
                    >
                      {c.companyName}
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>
          </div>
        ) : (
          <div
            className='vw-header-company vw-header-company--logo'
            aria-label={companyName ? `Empresa ${companyName}` : 'Empresa'}
          >
            <CompanyLogoMark
              key={companyLogo ?? companyName ?? 'none'}
              src={resolveValentineCompanyLogoSrc(companyLogo)}
              name={companyName}
              size='md'
            />
          </div>
        )}
        <ActionIcon
          className='vw-board-close'
          variant='filled'
          color='grape'
          radius='xl'
          size='lg'
          onClick={onClose}
          aria-label='Cerrar tablero'
        >
          <IconX size={18} />
        </ActionIcon>
      </header>

      <div
        className={
          showComposer && showBoard
            ? 'vw-board-body'
            : showComposer
              ? 'vw-board-body vw-board-body--compose'
              : 'vw-board-body vw-board-body--full'
        }
      >
        {showComposer ? (
          <div className='vw-composer-col vw-cork-ui'>
            <div className='vw-board-heart vw-board-heart--title vw-board-heart--3d'>
              — DOSIS —
              <br />
              DE AMOR Y AMISTAD
            </div>
            <aside className='vw-composer vw-composer--3d'>
              <h3>Escribe tu dosis</h3>
              <Text size='xs' c='dimmed'>
                {isMobile
                  ? 'Mensajes anónimos. Al publicar vuelves al tablero.'
                  : 'Mensajes anónimos. Arrastra el muro · rueda para mover · Ctrl+rueda zoom.'}
              </Text>

              <div className='vw-composer-cats'>
                {VALENTINE_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type='button'
                    className={
                      c.id === categoryId ? 'vw-cat-chip vw-cat-chip--active' : 'vw-cat-chip'
                    }
                    onClick={() => setCategoryId(c.id)}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>

              {catMeta ? (
                <Text size='xs' style={{ color: 'var(--vw-magenta)' }}>
                  {catMeta.hint}
                </Text>
              ) : null}

              <TextInput
                label='Para'
                description='Opcional — a quién va dirigida'
                placeholder='Ej. Ana, el equipo de ventas…'
                value={toName}
                onChange={(e) => setToName(e.currentTarget.value.slice(0, VALENTINE_TO_NAME_MAX))}
                maxLength={VALENTINE_TO_NAME_MAX}
                size='sm'
              />

              <Textarea
                label='Tu mensaje'
                placeholder='Una palabra desde el corazón…'
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
                maxLength={VALENTINE_MESSAGE_MAX}
                minRows={isMobile ? 4 : 3}
                autosize
                size='sm'
              />
              <Group justify='space-between' wrap='wrap' gap='sm'>
                <Text size='xs' c='dimmed'>
                  {message.length}/{VALENTINE_MESSAGE_MAX}
                </Text>
                <Group gap='xs'>
                  {isMobile ? (
                    <Button
                      variant='light'
                      color='grape'
                      radius='xl'
                      onClick={() => setComposerOpen(false)}
                    >
                      Ver tablero
                    </Button>
                  ) : null}
                  <Button
                    color='grape'
                    radius='xl'
                    loading={posting}
                    disabled={!canSend}
                    onClick={() => {
                      void (async () => {
                        try {
                          await onSubmit({
                            message: message.trim(),
                            categoryId,
                            toName: toName.trim() || null,
                          });
                          setMessage('');
                          setToName('');
                          if (isMobile) setComposerOpen(false);
                        } catch {
                          /* toast en el padre */
                        }
                      })();
                    }}
                  >
                    Pegar en el tablero ♥
                  </Button>
                </Group>
              </Group>
            </aside>
          </div>
        ) : null}

        {showBoard ? (
        <div
          ref={viewportRef}
          className={
            dragging
              ? 'vw-viewport vw-viewport--blush vw-viewport--dragging'
              : 'vw-viewport vw-viewport--blush'
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className='vw-viewport__fill' aria-hidden />
          <div
            ref={planeRef}
            className='vw-notes-plane'
            style={
              {
                width: BOARD_W,
                height: BOARD_H,
              } as CSSProperties
            }
          >
            {loading ? (
              <div className='vw-cork-loading'>
                <Loader color='grape' size='lg' />
                <Text mt='sm' size='sm' c='dimmed'>
                  Desplegando el tablero…
                </Text>
              </div>
            ) : posts.length === 0 ? (
              <div className='vw-empty vw-empty--cork'>
                El tablero espera tu primera dosis anónima.
                <br />
                Escribe y verás cómo se pega aquí.
              </div>
            ) : (
              posts.map((post, index) => {
                const layout = noteLayout(post.id, index);
                const isFresh = freshPostId === post.id;
                return (
                  <article
                    key={post.id}
                    className={
                      isFresh
                        ? `vw-note vw-note--3d vw-note--shade-${layout.shade} vw-note--land`
                        : `vw-note vw-note--3d vw-note--shade-${layout.shade}`
                    }
                    style={
                      {
                        left: layout.x,
                        top: layout.y,
                        '--vw-tilt': `${layout.tilt}deg`,
                        animationDelay: isFresh ? '0ms' : `${Math.min(index, 12) * 40}ms`,
                        zIndex: isFresh ? 40 : 10 + (index % 20),
                      } as CSSProperties
                    }
                  >
                    <span className='vw-note__pin' aria-hidden />
                    <span className='vw-note__tape' aria-hidden />
                    {canModerate && onDelete ? (
                      <button
                        type='button'
                        className='vw-note__delete'
                        disabled={deletingId === post.id}
                        title='Eliminar mensaje'
                        aria-label='Eliminar mensaje'
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm('¿Eliminar este mensaje del tablero?')) return;
                          setDeletingId(post.id);
                          void onDelete(post.id).finally(() => setDeletingId(null));
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    ) : null}
                    <div className='vw-note__cat'>
                      {categoryEmoji(post.categoryId)} {categoryLabel(post.categoryId)}
                    </div>
                    {post.toName ? (
                      <div className='vw-note__to'>Para: {post.toName}</div>
                    ) : null}
                    <p className='vw-note__msg'>{post.message}</p>
                    {post.createdAt ? (
                      <div className='vw-note__date'>{post.createdAt}</div>
                    ) : null}
                    <div
                      className='vw-note__reacts'
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {VALENTINE_REACTIONS.map((emoji) => {
                        const found = post.reactions.find((r) => r.emoji === emoji);
                        const count = found?.count ?? 0;
                        const mine = Boolean(found?.mine);
                        return (
                          <button
                            key={emoji}
                            type='button'
                            className={
                              mine ? 'vw-react-btn vw-react-btn--mine' : 'vw-react-btn'
                            }
                            disabled={reactingId === post.id}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReactingId(post.id);
                              void onReact(post.id, emoji).finally(() =>
                                setReactingId(null)
                              );
                            }}
                            aria-label={`Reaccionar con ${emoji}`}
                          >
                            <span aria-hidden>{emoji}</span>
                            {count > 0 ? (
                              <span className='vw-react-btn__count'>{count}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
        ) : null}
      </div>

      {revealDone && showBoard ? (
        <div
          className='vw-board-heart vw-board-heart--quote vw-board-heart--3d vw-quote-overlay vw-cork-ui'
          onPointerDown={(e) => e.stopPropagation()}
        >
          {VALENTINE_TAGLINE}
        </div>
      ) : null}

      <footer className='vw-board-footer vw-cork-ui'>
        {showBoard ? (
        <div className='vw-footer-left'>
          <Tooltip label={expanded ? 'Salir de pantalla completa' : 'Ampliar tablero'}>
            <ActionIcon
              variant='filled'
              color='grape'
              radius='xl'
              size='md'
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Reducir' : 'Ampliar'}
            >
              {expanded ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label='Alejar'>
            <ActionIcon
              variant='filled'
              color='grape'
              radius='xl'
              size='md'
              onClick={() => setZoomClamped(zoomRef.current - 0.1)}
              aria-label='Alejar'
            >
              <IconMinus size={16} />
            </ActionIcon>
          </Tooltip>
          <span className='vw-zoom-label'>{zoomLabel}%</span>
          <Tooltip label='Acercar'>
            <ActionIcon
              variant='filled'
              color='grape'
              radius='xl'
              size='md'
              onClick={() => setZoomClamped(zoomRef.current + 0.1)}
              aria-label='Acercar'
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label='Centrar vista'>
            <ActionIcon
              variant='filled'
              color='grape'
              radius='xl'
              size='md'
              onClick={resetView}
              aria-label='Centrar'
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
        ) : (
          <div className='vw-footer-left vw-footer-left--spacer' aria-hidden />
        )}

        <div className='vw-footer-logo'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src='/Logo_Principal.svg'
            alt='SynerLink'
            className='vw-synerlink-logo'
            width={168}
            height={48}
          />
        </div>

        <div className='vw-footer-right'>
          <Button
            size={isMobile ? 'md' : 'sm'}
            variant={composerOpen ? 'light' : 'filled'}
            color='grape'
            radius='xl'
            fullWidth={isMobile}
            className='vw-mode-toggle'
            onClick={() => setComposerOpen((v) => !v)}
          >
            {composerOpen
              ? isMobile
                ? 'Ver tablero'
                : 'Ocultar escribir'
              : 'Escribir dosis'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
