'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Indicator, Tooltip } from '@mantine/core';
import toast from 'react-hot-toast';
import type { ValentineCategoryId } from '../../lib/valentine/constants';
import ValentineEnvelope from './ValentineEnvelope';
import ValentineHearts from './ValentineHearts';
import ValentineWallBoard, { type ValentinePost } from './ValentineWallBoard';
import './valentine.css';

type Phase = 'closed' | 'arriving' | 'envelope' | 'opening' | 'board';

export default function ValentineWallRoot() {
  const [canAccess, setCanAccess] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>('closed');
  const [posts, setPosts] = useState<ValentinePost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [posting, setPosting] = useState(false);
  const [unreadHint, setUnreadHint] = useState(0);
  const [freshPostId, setFreshPostId] = useState<number | null>(null);
  const [origin, setOrigin] = useState({ x: 80, y: 8 });
  const [burst, setBurst] = useState(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const arriveTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/valentine-wall/access')
      .then(async (r) => {
        if (!r.ok) return { canAccess: false };
        return r.json() as Promise<{ canAccess?: boolean; canModerate?: boolean }>;
      })
      .then((data) => {
        if (cancelled) return;
        setCanAccess(Boolean(data.canAccess));
        setCanModerate(Boolean(data.canModerate));
        if (data.canAccess) {
          const seen = localStorage.getItem('vw-olp-seen-2026');
          setUnreadHint(seen ? 0 : 1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanAccess(false);
          setCanModerate(false);
        }
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (arriveTimer.current) window.clearTimeout(arriveTimer.current);
      if (openTimer.current) window.clearTimeout(openTimer.current);
    };
  }, []);

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const res = await fetch('/api/valentine-wall');
      if (!res.ok) throw new Error('No se pudo cargar el muro');
      const data = (await res.json()) as { posts?: ValentinePost[] };
      setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  const openEnvelope = () => {
    const btn = bellRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const xPct = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
      const yPct = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
      setOrigin({ x: xPct, y: yPct });
    } else {
      setOrigin({ x: 88, y: 6 });
    }

    setBurst(true);
    window.setTimeout(() => setBurst(false), 700);
    localStorage.setItem('vw-olp-seen-2026', '1');
    setUnreadHint(0);
    setPhase('arriving');
    if (arriveTimer.current) window.clearTimeout(arriveTimer.current);
    arriveTimer.current = window.setTimeout(() => setPhase('envelope'), 1100);
  };

  const openBoard = () => {
    setPhase('opening');
    void loadPosts();
    if (openTimer.current) window.clearTimeout(openTimer.current);
    // Tiempo alineado con la animación 3D del tablero (~2.4s)
    openTimer.current = window.setTimeout(() => {
      setPhase('board');
    }, 2450);
  };

  const closeAll = () => {
    if (arriveTimer.current) window.clearTimeout(arriveTimer.current);
    if (openTimer.current) window.clearTimeout(openTimer.current);
    setPhase('closed');
  };

  const handleSubmit = async (payload: {
    message: string;
    categoryId: ValentineCategoryId;
    toName?: string | null;
  }) => {
    setPosting(true);
    try {
      const res = await fetch('/api/valentine-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { post?: ValentinePost; error?: string };
      if (!res.ok) throw new Error(data.error || 'No se pudo publicar');
      if (data.post) {
        setPosts((prev) => [data.post!, ...prev]);
        setFreshPostId(data.post.id);
        window.setTimeout(() => setFreshPostId(null), 1600);
      }
      toast.success('¡Dosis pegada en el tablero!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al publicar');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (postId: number) => {
    try {
      const res = await fetch(`/api/valentine-wall/${postId}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'No se pudo borrar');
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      toast.success('Mensaje eliminado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al borrar');
    }
  };

  const handleReact = async (postId: number, emoji: string) => {
    try {
      const res = await fetch(`/api/valentine-wall/${postId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      const data = (await res.json()) as { added?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo reaccionar');
      }
      const added = Boolean(data.added);
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== postId) return p;
          const reactions = [...p.reactions];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (added) {
            if (idx >= 0) {
              reactions[idx] = {
                ...reactions[idx],
                count: reactions[idx].count + 1,
                mine: true,
              };
            } else {
              reactions.push({ emoji, count: 1, mine: true });
            }
          } else if (idx >= 0) {
            const nextCount = reactions[idx].count - 1;
            if (nextCount <= 0) reactions.splice(idx, 1);
            else
              reactions[idx] = {
                ...reactions[idx],
                count: nextCount,
                mine: false,
              };
          }
          return { ...p, reactions };
        })
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al reaccionar');
    }
  };

  useEffect(() => {
    if (phase === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (!checked || !canAccess) return null;

  const showEnvelope = phase === 'arriving' || phase === 'envelope' || phase === 'opening';
  const showBoard = phase === 'opening' || phase === 'board';

  return (
    <div className='vw-root vw-bell-wrap'>
      <link
        rel='stylesheet'
        href='https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito:wght@500;600;700&display=swap'
      />
      <Tooltip label='Dosis de Amor y Amistad' withArrow>
        <Indicator
          processing={unreadHint > 0}
          disabled={unreadHint === 0}
          color='pink'
          size={10}
          offset={3}
        >
          <button
            ref={bellRef}
            type='button'
            className={burst ? 'vw-handler vw-handler--burst' : 'vw-handler'}
            onClick={openEnvelope}
            aria-label='Abrir Dosis de Amor y Amistad'
          >
            <span className='vw-handler__glow' aria-hidden />
            <span className='vw-handler__heart' aria-hidden>
              ♥
            </span>
          </button>
        </Indicator>
      </Tooltip>

      {burst ? (
        <span className='vw-bell-spark' aria-hidden>
          ♥
        </span>
      ) : null}

      {phase !== 'closed' ? (
        <div
          className={
            phase === 'arriving' ? 'vw-overlay vw-overlay--soft vw-overlay--fade-in' : 'vw-overlay vw-overlay--soft'
          }
          role='dialog'
          aria-modal='true'
          aria-label='Muro San Valentín OLP'
          style={
            {
              '--vw-origin-x': `${origin.x}%`,
              '--vw-origin-y': `${origin.y}%`,
            } as CSSProperties
          }
        >
          <ValentineHearts count={phase === 'board' || phase === 'opening' ? 8 : 6} />
          {showEnvelope ? (
            <ValentineEnvelope
              arriving={phase === 'arriving'}
              open={phase === 'opening'}
              onOpen={openBoard}
            />
          ) : null}
          {showBoard ? (
            <ValentineWallBoard
              posts={posts}
              loading={loadingPosts}
              posting={posting}
              freshPostId={freshPostId}
              canModerate={canModerate}
              onClose={closeAll}
              onSubmit={handleSubmit}
              onReact={handleReact}
              onDelete={handleDelete}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
