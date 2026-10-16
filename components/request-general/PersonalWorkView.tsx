'use client';

import { useMemo } from 'react';
import {
  IconCalendarCheck,
  IconClipboardList,
  IconClockExclamation,
  IconListCheck,
} from '@tabler/icons-react';
import { useSolicitadoData } from './SolicitadoShell';
import { SolicitadoActividadesView } from './SolicitadoActividadesView';
import { SolicitadoProcesosView } from './SolicitadoAnalyticsView';
import { STALE_DAYS, daysSince } from '../../lib/request-general/teamWorkload';
import { KpiTile, PanelSection, ToneChip, panelStyles as s } from '../ui/panel/Panel';

function isClosedStatus(status?: string | null): boolean {
  const v = String(status ?? '').toLowerCase();
  return ['resuelt', 'complet', 'cancel', 'cerrad', 'borrador'].some((k) => v.includes(k));
}

function isResolvedStatus(status?: string | null): boolean {
  const v = String(status ?? '').toLowerCase();
  return v.includes('resuelt') || v.includes('complet');
}

/**
 * «Mi trabajo»: resumen de hoy y, debajo, las gráficas y tiempos de las solicitudes de
 * mis procesos y de mis actividades (sin sus tablas). Para el líder van primero las solicitudes.
 */
export function PersonalWorkView() {
  const { allActivities, allRequests, activities, appliedRange } = useSolicitadoData();

  const summary = useMemo(() => {
    const now = new Date();
    const pendingActivities = allActivities.filter((a) => !isClosedStatus(a.status_task));
    const openRequests = allRequests.filter((r) => !isClosedStatus(r.status));
    const isStale = (date?: string | null) => (daysSince(date, now) ?? 0) > STALE_DAYS;

    return {
      pendingActivities: pendingActivities.length,
      openRequests: openRequests.length,
      completed: activities.filter((a) => isResolvedStatus(a.status_task)).length,
      stale:
        openRequests.filter((r) => isStale(r.created_at)).length +
        pendingActivities.filter((a) => isStale(a.start_date)).length,
    };
  }, [allActivities, allRequests, activities]);

  return (
    <>
      <PanelSection title='Resumen' hint={`Pendientes: hoy · Completadas: ${appliedRange}`}>
        <div className={s.grid4}>
          <KpiTile
            icon={<IconClipboardList size={16} stroke={2} />}
            label='Solicitudes abiertas'
            value={String(summary.openRequests)}
            foot='De los procesos que gestionas'
          />
          <KpiTile
            icon={<IconListCheck size={16} stroke={2} />}
            label='Actividades pendientes'
            value={String(summary.pendingActivities)}
            foot='Asignadas a ti'
          />
          <KpiTile
            icon={<IconCalendarCheck size={16} stroke={2} />}
            label='Actividades completadas'
            value={String(summary.completed)}
            foot='En el periodo elegido'
          />
          <KpiTile
            icon={<IconClockExclamation size={16} stroke={2} />}
            label={`Más de ${STALE_DAYS} días abiertas`}
            value={String(summary.stale)}
            tone={summary.stale > 0 ? 'warning' : 'ok'}
            foot={
              summary.stale > 0 ? (
                <ToneChip tone='warning' label='Revisar' />
              ) : (
                <ToneChip tone='ok' label='Nada atrasado' />
              )
            }
          />
        </div>
      </PanelSection>

      <PanelSection title='Cómo voy en las solicitudes de mis procesos' hint={appliedRange}>
        <SolicitadoProcesosView showList={false} />
      </PanelSection>

      <PanelSection title='Cómo voy en mis actividades' hint={appliedRange}>
        <SolicitadoActividadesView showList={false} />
      </PanelSection>
    </>
  );
}
