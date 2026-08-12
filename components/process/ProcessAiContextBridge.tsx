'use client';

/**
 * Publica al asistente lo que hay en el Hub de Procesos (lista real).
 * Solo cuando la sección activa es Procesos.
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useRegisterAiPageContext } from '../../lib/ai/AiAssistantContext';
import { useProcessData } from '../../lib/process/ProcessDataContext';
import { useAppSection } from '../../lib/navigation/AppSectionContext';
import { isHubHiddenRequestDashboardSubprocess } from '../../lib/request-general/dashboardAccess';

export default function ProcessAiContextBridge() {
  const pathname = usePathname() || '';
  const { activeSection } = useAppSection();
  const { processes, loading, error } = useProcessData();

  const active =
    activeSection === 'process' &&
    (pathname === '/process' || pathname === '/process/');

  const screenSummary = useMemo(() => {
    const visible = processes
      .map((p) => ({
        ...p,
        subprocesses: p.subprocesses.filter(
          (s) => !isHubHiddenRequestDashboardSubprocess(s),
        ),
      }))
      .filter((p) => p.subprocesses.length > 0);

    const lines: string[] = [
      '### En esta página',
      'Estás en el **Hub de Procesos** de SynerLink.',
      'Aquí ves los **procesos y subprocesos** asignados a tu usuario; desde cada tarjeta entras al módulo (Help Desk, solicitudes, etc.).',
      '',
    ];

    if (loading) {
      lines.push('_Cargando catálogo de procesos…_');
    } else if (error) {
      lines.push(`_No pude cargar procesos: ${error}_`);
    } else if (!visible.length) {
      lines.push('_No tienes procesos asignados en este momento._');
    } else {
      lines.push(`#### Procesos visibles (**${visible.length}**)`);
      for (const p of visible.slice(0, 12)) {
        const subs = p.subprocesses
          .slice(0, 6)
          .map((s) => s.subprocess)
          .join(', ');
        const more =
          p.subprocesses.length > 6
            ? ` (+${p.subprocesses.length - 6} más)`
            : '';
        lines.push(
          `- **${p.process}** (${p.subprocesses.length} subprocesos): ${subs}${more}`,
        );
      }
      if (visible.length > 12) {
        lines.push(`- _…y ${visible.length - 12} procesos más_`);
      }
    }

    lines.push('');
    lines.push(
      'Puedes pedirme: *“¿qué procesos tengo?”*, *“cómo creo un ticket”*, o *“llévame a Dashboard solicitudes”*.',
    );
    return lines.join('\n');
  }, [processes, loading, error]);

  useRegisterAiPageContext(
    active
      ? {
          pageLabel: 'Procesos',
          pageKind: 'process-hub',
          extra: screenSummary,
          facts: {
            procesos_visibles: processes.filter((p) =>
              p.subprocesses.some(
                (s) => !isHubHiddenRequestDashboardSubprocess(s),
              ),
            ).length,
            cargando: loading,
          },
        }
      : null,
  );

  return null;
}
