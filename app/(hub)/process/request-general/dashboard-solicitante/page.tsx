'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Center, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import {
  RequestRoleDashboard,
  type DashboardActivityRow,
  type DashboardCounts,
  type DashboardRequestRow,
} from '../../../../../components/request-general/RequestRoleDashboard';
import { useRegisterAiPageContext } from '../../../../../lib/ai/AiAssistantContext';

const EMPTY_COUNTS: DashboardCounts = {
  total: 0,
  abierto: 0,
  enProgreso: 0,
  resuelto: 0,
  cancelado: 0,
  otros: 0,
};

export default function DashboardSolicitantePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<DashboardRequestRow[]>([]);
  const [activities, setActivities] = useState<DashboardActivityRow[]>([]);
  const [requestCounts, setRequestCounts] = useState<DashboardCounts>(EMPTY_COUNTS);
  const [activityCounts, setActivityCounts] = useState<DashboardCounts>(EMPTY_COUNTS);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const accessRes = await fetch(
          '/api/requests-general/dashboard-access?kind=solicitante',
          { credentials: 'same-origin', cache: 'no-store' }
        );
        const accessData = await accessRes.json().catch(() => ({}));
        if (!accessRes.ok || !accessData.allowed) {
          throw new Error(
            accessData.error ||
              'No tienes asignado el subproceso Dashboard solicitudes'
          );
        }

        const res = await fetch('/api/requests-general/dashboard-solicitante', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo cargar el dashboard');
        }

        if (cancelled) return;
        setRequests(Array.isArray(data.requests) ? data.requests : []);
        setActivities(Array.isArray(data.activities) ? data.activities : []);
        setRequestCounts(data.counts?.requests ?? EMPTY_COUNTS);
        setActivityCounts(data.counts?.activities ?? EMPTY_COUNTS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, status, router]);

  const screenSummary = error
    ? `### En esta página\n**Dashboard solicitudes** — error: ${error}`
    : loading
      ? '### En esta página\n**Dashboard solicitudes** — cargando tus datos…'
      : [
          '### En esta página',
          'Estás en **Dashboard solicitudes**: resumen de lo que **tú pediste** (no lo asignado a ti).',
          '',
          '#### Tus solicitudes',
          `- Total: **${requestCounts.total}**`,
          `- Abiertas: **${requestCounts.abierto}** · En progreso: **${requestCounts.enProgreso}**`,
          `- Resueltas: **${requestCounts.resuelto}** · Canceladas: **${requestCounts.cancelado}**`,
          '',
          '#### Actividades asociadas',
          `- Total: **${activityCounts.total}** (abiertas: ${activityCounts.abierto}, en progreso: ${activityCounts.enProgreso}, resueltas: ${activityCounts.resuelto})`,
          '',
          'Puedo listar abiertas, detallar un **#id** o ayudarte a crear otra solicitud.',
        ].join('\n');

  useRegisterAiPageContext({
    pageLabel: 'Dashboard solicitudes',
    pageKind: 'dashboard-solicitante',
    extra: screenSummary,
    facts: {
      solicitudes_total: requestCounts.total,
      solicitudes_abiertas: requestCounts.abierto,
      actividades_total: activityCounts.total,
      cargando: loading,
    },
  });

  if (status === 'loading' || loading) {
    return (
      <Center mih='50vh'>
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title='Dashboard solicitudes' color='red' m='md'>
        {error}
      </Alert>
    );
  }

  return (
    <RequestRoleDashboard
      kind='solicitante'
      title='Dashboard solicitudes'
      subtitle='Resumen de tus procesos (solicitudes) y las actividades asociadas'
      requests={requests}
      activities={activities}
      requestCounts={requestCounts}
      activityCounts={activityCounts}
    />
  );
}
