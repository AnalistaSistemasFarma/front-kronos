'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PageContextSnapshot } from './assistantPrompt';

/** Contexto temporal que publica la página activa al asistente. */
export type AiPageExtras = Partial<
  Pick<
    PageContextSnapshot,
    | 'requestId'
    | 'requestSubject'
    | 'requestDescription'
    | 'requestCompany'
    | 'requestStatus'
    | 'extra'
    | 'pageLabel'
    | 'pageKind'
  >
> & {
  /** Hechos libres clave=valor para el prompt. */
  facts?: Record<string, string | number | boolean | null | undefined>;
};

interface AiAssistantContextValue {
  /** Contexto efectivo (ruta + página). */
  pageExtras: AiPageExtras;
  /** Datos ricos de la pantalla (prioridad alta). */
  setPageExtras: (extras: AiPageExtras | null) => void;
  /** Contexto base por ruta (prioridad baja). */
  setRouteExtras: (extras: AiPageExtras | null) => void;
}

const AiAssistantContext = createContext<AiAssistantContextValue | null>(null);

function isRichScreenExtra(extra?: string | null): boolean {
  if (!extra) return false;
  return (
    extra.includes('\n') ||
    extra.includes('###') ||
    extra.includes('**Pestaña') ||
    extra.length > 160
  );
}

function factsToPromptLine(facts?: AiPageExtras['facts']): string | null {
  if (!facts) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(facts)) {
    if (v == null || v === '') continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Normaliza sin destruir resúmenes markdown de pantalla.
 * Los facts se conservan aparte; solo se aplanan a `extra` si no hay resumen rico.
 */
function normalizeExtras(extras: AiPageExtras | null): AiPageExtras {
  if (!extras) return {};
  const { facts, extra, ...rest } = extras;
  const base = extra?.trim() || null;
  if (isRichScreenExtra(base)) {
    return { ...rest, facts, extra: base };
  }
  const flatFacts = factsToPromptLine(facts);
  if (!base && !flatFacts) return { ...rest, facts };
  if (!base) return { ...rest, facts, extra: flatFacts };
  if (!flatFacts) return { ...rest, facts, extra: base };
  return { ...rest, facts, extra: `${base} · ${flatFacts}` };
}

function mergeExtras(route: AiPageExtras, page: AiPageExtras): AiPageExtras {
  const merged: AiPageExtras = {
    ...route,
    ...page,
    facts: { ...(route.facts || {}), ...(page.facts || {}) },
  };

  const routeExtra = route.extra?.trim() || null;
  const pageExtra = page.extra?.trim() || null;

  // Prioridad: resumen rico de página > resumen rico de ruta > concatenación corta
  if (isRichScreenExtra(pageExtra)) {
    merged.extra = pageExtra;
  } else if (isRichScreenExtra(routeExtra) && !pageExtra) {
    merged.extra = routeExtra;
  } else if (pageExtra && routeExtra && pageExtra !== routeExtra) {
    // Evitar mezclar "ruta: /x" delante de un resumen de pantalla
    if (routeExtra.startsWith('ruta:') || routeExtra.length < 40) {
      merged.extra = pageExtra;
    } else {
      merged.extra = `${routeExtra} · ${pageExtra}`;
    }
  } else {
    merged.extra = pageExtra || routeExtra || null;
  }

  return merged;
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [routeExtras, setRouteExtrasState] = useState<AiPageExtras>({});
  const [pageExtrasRaw, setPageExtrasState] = useState<AiPageExtras>({});

  const setPageExtras = useCallback((extras: AiPageExtras | null) => {
    setPageExtrasState(normalizeExtras(extras));
  }, []);

  const setRouteExtras = useCallback((extras: AiPageExtras | null) => {
    setRouteExtrasState(normalizeExtras(extras));
  }, []);

  const pageExtras = useMemo(
    () => mergeExtras(routeExtras, pageExtrasRaw),
    [routeExtras, pageExtrasRaw],
  );

  const value = useMemo(
    () => ({ pageExtras, setPageExtras, setRouteExtras }),
    [pageExtras, setPageExtras, setRouteExtras],
  );

  return (
    <AiAssistantContext.Provider value={value}>
      {children}
    </AiAssistantContext.Provider>
  );
}

export function useAiAssistantPageContext() {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) {
    throw new Error(
      'useAiAssistantPageContext debe usarse dentro de AiAssistantProvider',
    );
  }
  return ctx;
}

/** Hook seguro: si no hay provider, no rompe (páginas fuera del hub). */
export function useAiAssistantPageExtrasOptional() {
  return useContext(AiAssistantContext);
}

/**
 * Publica contexto temporal de la página (prioridad alta).
 * Se limpia al desmontar.
 */
export function useRegisterAiPageContext(extras: AiPageExtras | null) {
  const ctx = useAiAssistantPageExtrasOptional();
  const setPageExtras = ctx?.setPageExtras;
  const serialized = useMemo(
    () => (extras ? JSON.stringify(normalizeExtras(extras)) : null),
    [extras],
  );
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!setPageExtras) return;

    if (!serialized) {
      setPageExtras(null);
      lastSent.current = null;
      return;
    }
    if (lastSent.current === serialized) return;
    lastSent.current = serialized;
    setPageExtras(JSON.parse(serialized) as AiPageExtras);

    return () => {
      setPageExtras(null);
      lastSent.current = null;
    };
  }, [setPageExtras, serialized]);
}

/**
 * Contexto base por ruta (prioridad baja). Lo usa AiRouteContextBridge.
 */
export function useRegisterAiRouteContext(extras: AiPageExtras | null) {
  const ctx = useAiAssistantPageExtrasOptional();
  const setRouteExtras = ctx?.setRouteExtras;
  const serialized = useMemo(
    () => (extras ? JSON.stringify(normalizeExtras(extras)) : null),
    [extras],
  );
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!setRouteExtras) return;

    if (!serialized) {
      setRouteExtras(null);
      lastSent.current = null;
      return;
    }
    if (lastSent.current === serialized) return;
    lastSent.current = serialized;
    setRouteExtras(JSON.parse(serialized) as AiPageExtras);

    return () => {
      setRouteExtras(null);
      lastSent.current = null;
    };
  }, [setRouteExtras, serialized]);
}
