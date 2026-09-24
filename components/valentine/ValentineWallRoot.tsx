'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Indicator, Tooltip } from '@mantine/core';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import type { ValentineCategoryId } from '../../lib/valentine/constants';
import ValentineEnvelope from './ValentineEnvelope';
import ValentineHearts from './ValentineHearts';
import ValentineWallBoard, { type ValentinePost } from './ValentineWallBoard';
import './valentine.css';

type Phase = 'closed' | 'arriving' | 'envelope' | 'opening' | 'board';

type WallCompany = {
  idCompany: number;
  companyName: string;
};

type RealtimeEvent =
  | { type: 'connected'; companyId: number }
  | {
      type: 'post_created';
      companyId: number;
      post: ValentinePost;
    }
  | { type: 'post_deleted'; companyId: number; postId: number }
  | {
      type: 'reaction_changed';
      companyId: number;
      postId: number;
      emoji: string;
      added: boolean;
      userId: string;
    };

const POLL_MS = 5000;

function readSelectedCompanyId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('selectedCompany');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { id?: number };
    return parsed?.id != null && Number.isFinite(parsed.id) ? Number(parsed.id) : null;
  } catch {
    return null;
  }
}

function seenKey(companyId: number) {
  return `vw-seen-${companyId}-2026`;
}

function applyReactionChange(
  posts: ValentinePost[],
  event: Extract<RealtimeEvent, { type: 'reaction_changed' }>,
  myUserId: string
): ValentinePost[] {
  return posts.map((p) => {
    if (p.id !== event.postId) return p;
    const reactions = [...p.reactions];
    const idx = reactions.findIndex((r) => r.emoji === event.emoji);
    const isMine = String(event.userId) === String(myUserId);

    if (event.added) {
      if (idx >= 0) {
        reactions[idx] = {
          ...reactions[idx],
          count: reactions[idx].count + 1,
          mine: reactions[idx].mine || isMine,
        };
      } else {
        reactions.push({ emoji: event.emoji, count: 1, mine: isMine });
      }
    } else if (idx >= 0) {
      const nextCount = reactions[idx].count - 1;
      if (nextCount <= 0) reactions.splice(idx, 1);
      else
        reactions[idx] = {
          ...reactions[idx],
          count: nextCount,
          mine: isMine ? false : reactions[idx].mine,
        };
    }
    return { ...p, reactions };
  });
}

export default function ValentineWallRoot() {
  const { data: session } = useSession();
  const myUserId = String(session?.user?.id || '').trim();

  const [canAccess, setCanAccess] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [company, setCompany] = useState<WallCompany | null>(null);
  const [companies, setCompanies] = useState<WallCompany[]>([]);
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
  const freshTimer = useRef<number | null>(null);
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  useEffect(() => {
    let cancelled = false;
    const preferred = readSelectedCompanyId();
    const qs =
      preferred != null
        ? `?companyId=${encodeURIComponent(String(preferred))}`
        : '';

    void fetch(`/api/valentine-wall/access${qs}`)
      .then(async (r) => {
        if (!r.ok) return { canAccess: false };
        return r.json() as Promise<{
          canAccess?: boolean;
          canModerate?: boolean;
          company?: WallCompany | null;
          companies?: WallCompany[];
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        const moderate = Boolean(data.canModerate);
        setCanAccess(Boolean(data.canAccess));
        setCanModerate(moderate);
        const list = Array.isArray(data.companies) ? data.companies : [];
        setCompanies(moderate ? list : []);
        const c = data.company ?? list[0] ?? null;
        setCompany(c);
        if (data.canAccess && c) {
          const seen = localStorage.getItem(seenKey(c.idCompany));
          setUnreadHint(seen ? 0 : 1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanAccess(false);
          setCanModerate(false);
          setCompany(null);
          setCompanies([]);
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
      if (freshTimer.current) window.clearTimeout(freshTimer.current);
    };
  }, []);

  const markFresh = useCallback((postId: number) => {
    setFreshPostId(postId);
    if (freshTimer.current) window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFreshPostId(null), 1600);
  }, []);

  const loadPostsForCompany = useCallback(
    async (idCompany: number, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingPosts(true);
      try {
        const res = await fetch(
          `/api/valentine-wall?companyId=${encodeURIComponent(String(idCompany))}`
        );
        if (!res.ok) throw new Error('No se pudo cargar el muro');
        const data = (await res.json()) as {
          posts?: ValentinePost[];
          company?: WallCompany;
        };
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        if (data.company) setCompany(data.company);
      } catch (err) {
        if (!opts?.silent) {
          toast.error(err instanceof Error ? err.message : 'Error al cargar');
        }
      } finally {
        if (!opts?.silent) setLoadingPosts(false);
      }
    },
    []
  );

  const applyRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'connected') return;

      if (event.type === 'post_created') {
        setPosts((prev) => {
          if (prev.some((p) => p.id === event.post.id)) return prev;
          return [event.post, ...prev];
        });
        markFresh(event.post.id);
        return;
      }

      if (event.type === 'post_deleted') {
        setPosts((prev) => prev.filter((p) => p.id !== event.postId));
        return;
      }

      if (event.type === 'reaction_changed') {
        // La reacción propia ya se aplicó de forma optimista
        if (
          myUserIdRef.current &&
          String(event.userId) === String(myUserIdRef.current)
        ) {
          return;
        }
        setPosts((prev) =>
          applyReactionChange(prev, event, myUserIdRef.current)
        );
      }
    },
    [markFresh]
  );

  // SSE (inmediato) + polling de respaldo (multi-instancia / proxy)
  useEffect(() => {
    const boardOpen = phase === 'opening' || phase === 'board';
    if (!boardOpen || !company) return;

    const companyId = company.idCompany;
    let cancelled = false;
    let es: EventSource | null = null;

    const pollTimer = window.setInterval(() => {
      void loadPostsForCompany(companyId, { silent: true });
    }, POLL_MS);

    try {
      es = new EventSource(
        `/api/valentine-wall/stream?companyId=${encodeURIComponent(String(companyId))}`
      );
      es.onmessage = (msg) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(msg.data) as RealtimeEvent;
          applyRealtimeEvent(data);
        } catch {
          /* ignore malformed */
        }
      };
    } catch {
      /* EventSource no disponible: el poll basta */
    }

    return () => {
      cancelled = true;
      if (es) es.close();
      window.clearInterval(pollTimer);
    };
  }, [phase, company?.idCompany, loadPostsForCompany, applyRealtimeEvent]);

  const handleCompanyChange = useCallback(
    (idCompany: number) => {
      if (!canModerate) return;
      const next = companies.find((c) => c.idCompany === idCompany);
      if (!next || next.idCompany === company?.idCompany) return;
      setCompany(next);
      setPosts([]);
      setFreshPostId(null);
      void loadPostsForCompany(idCompany);
    },
    [canModerate, companies, company?.idCompany, loadPostsForCompany]
  );

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
    if (company) localStorage.setItem(seenKey(company.idCompany), '1');
    setUnreadHint(0);
    setPhase('arriving');
    if (arriveTimer.current) window.clearTimeout(arriveTimer.current);
    arriveTimer.current = window.setTimeout(() => setPhase('envelope'), 1100);
  };

  const openBoard = () => {
    setPhase('opening');
    if (company) void loadPostsForCompany(company.idCompany);
    if (openTimer.current) window.clearTimeout(openTimer.current);
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
    if (!company) return;
    setPosting(true);
    try {
      const res = await fetch('/api/valentine-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, companyId: company.idCompany }),
      });
      const data = (await res.json()) as { post?: ValentinePost; error?: string };
      if (!res.ok) throw new Error(data.error || 'No se pudo publicar');
      if (data.post) {
        setPosts((prev) => {
          if (prev.some((p) => p.id === data.post!.id)) return prev;
          return [data.post!, ...prev];
        });
        markFresh(data.post.id);
      }
      toast.success('¡Dosis pegada en el tablero!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al publicar');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (postId: number) => {
    if (!company) return;
    try {
      const res = await fetch(
        `/api/valentine-wall/${postId}?companyId=${encodeURIComponent(String(company.idCompany))}`,
        { method: 'DELETE' }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'No se pudo borrar');
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      toast.success('Mensaje eliminado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al borrar');
    }
  };

  const handleReact = async (postId: number, emoji: string) => {
    if (!company) return;
    try {
      const res = await fetch(`/api/valentine-wall/${postId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, companyId: company.idCompany }),
      });
      const data = (await res.json()) as { added?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo reaccionar');
      }
      // El SSE / poll sincroniza; optimista local:
      applyRealtimeEvent({
        type: 'reaction_changed',
        companyId: company.idCompany,
        postId,
        emoji,
        added: Boolean(data.added),
        userId: myUserIdRef.current,
      });
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

  if (!checked || !canAccess || !company) return null;

  const showEnvelope = phase === 'arriving' || phase === 'envelope' || phase === 'opening';
  const showBoard = phase === 'opening' || phase === 'board';

  return (
    <div className='vw-root vw-bell-wrap'>
      <link
        rel='stylesheet'
        href='https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito:wght@500;600;700&display=swap'
      />
      <Tooltip label={`Dosis de Amor y Amistad · ${company.companyName}`} withArrow>
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
            aria-label={`Abrir Dosis de Amor y Amistad (${company.companyName})`}
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
          aria-label={`Muro San Valentín ${company.companyName}`}
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
              companyName={company.companyName}
              companyId={company.idCompany}
              companies={canModerate ? companies : []}
              onCompanyChange={canModerate ? handleCompanyChange : undefined}
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
