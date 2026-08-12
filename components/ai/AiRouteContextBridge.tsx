'use client';

/**
 * Contexto base por ruta: al navegar, el asistente recibe etiqueta + resumen
 * de ESA pantalla (catálogo). Las páginas con datos vivos lo enriquecen.
 */

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRegisterAiRouteContext } from '../../lib/ai/AiAssistantContext';
import { resolveScreenDef } from '../../lib/ai/routeScreenCatalog';

export default function AiRouteContextBridge() {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';

  const extras = useMemo(() => {
    const d = resolveScreenDef(pathname, search ? `?${search}` : '');
    return {
      pageLabel: d.pageLabel,
      pageKind: d.pageKind,
      requestId:
        d.requestId && d.pageKind.includes('request') ? d.requestId : undefined,
      extra: d.baseExtra,
      facts: {
        ruta: pathname + (search ? `?${search}` : ''),
        pantalla: d.pageLabel,
        tipo: d.pageKind,
      },
    };
  }, [pathname, searchParams, search]);

  useRegisterAiRouteContext(extras);

  return null;
}
