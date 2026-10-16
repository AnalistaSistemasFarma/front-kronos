'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Anchor, Card, Grid, Group, Text, Title } from '@mantine/core';
import { IconBook, IconChecklist, IconCopy, IconSchool, IconShieldCheck } from '@tabler/icons-react';
import { SGC_BASE_URL } from '../../lib/sgc/constants';
import { SGC_PENDING_GROUPS, SGC_PENDING_LABELS, type SgcPendingCounts, type SgcPendingGroup } from '../../lib/sgc/pendings';
import { sgcHref } from './useSgcCompany';
import { useSgcFetch } from './useSgcFetch';

/**
 * «MIS PENDIENTES DEL SGC» (Sprint 9, socialización con Calidad OLP del
 * 2026-10-07: menos correos, más avisos dentro de la app). Va en la entrada
 * del módulo. Las tarjetas son COPIA CONGELADA del «KpiCard» de los tableros
 * de solicitudes de SynerLink (components/request-general/RequestRoleDashboard.tsx);
 * la prueba de paridad las compara.
 */

/** Copia congelada del KpiCard de SynerLink (mismo marcado y estilos). */
export function SgcKpiCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: ReactNode }) {
  return (
    <Card p='md' radius='md' withBorder style={{ backgroundColor: `var(--mantine-color-${color}-light)` }}>
      <Group>
        {icon}
        <div>
          <Text size='xs' c={`var(--mantine-color-${color}-light-color)`}>
            {label}
          </Text>
          <Text size='lg' fw={700}>
            {value}
          </Text>
        </div>
      </Group>
    </Card>
  );
}

const COLORS: Record<SgcPendingGroup, string> = { tareas: 'blue', lecturas: 'teal', autorizaciones: 'orange', capacitaciones: 'grape', copias: 'gray' };
// Mismo tamaño y color de ícono que los KpiCard de SynerLink.
const iconColor = (g: SgcPendingGroup) => `var(--mantine-color-${COLORS[g]}-light-color)`;
const ICONS: Record<SgcPendingGroup, ReactNode> = {
  tareas: <IconChecklist size={22} color={iconColor('tareas')} />,
  lecturas: <IconBook size={22} color={iconColor('lecturas')} />,
  autorizaciones: <IconShieldCheck size={22} color={iconColor('autorizaciones')} />,
  capacitaciones: <IconSchool size={22} color={iconColor('capacitaciones')} />,
  copias: <IconCopy size={22} color={iconColor('copias')} />,
};
const LINKS: Record<SgcPendingGroup, string> = { tareas: 'tareas', lecturas: 'tareas', autorizaciones: 'autorizaciones', capacitaciones: 'tareas', copias: 'copias' };

export interface SgcPendingData {
  counts: SgcPendingCounts;
  items: { group: SgcPendingGroup; idTask: number; idRequest: number; subject: string; task: string; createdAt: string }[];
}

export function SgcPendingBoardView({ data, idCompany, groups = SGC_PENDING_GROUPS }: { data: SgcPendingData; idCompany: number; groups?: readonly SgcPendingGroup[] }) {
  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mb='lg' data-testid='sgc-mis-pendientes'>
      <Group justify='space-between' mb='md'>
        <Title order={4}>Mis pendientes del SGC</Title>
        <Text size='sm' c='dimmed' data-testid='sgc-mis-pendientes-total'>
          {data.counts.total === 0 ? 'No tiene pendientes.' : `${data.counts.total} pendiente(s)`}
        </Text>
      </Group>
      <Grid>
        {groups.map((g) => (
          <Grid.Col key={g} span={{ base: 12, sm: 6, md: 12 / Math.min(groups.length, 4) }}>
            <Anchor component={Link} href={sgcHref(`${SGC_BASE_URL}/${LINKS[g]}`, idCompany)} underline='never' data-testid={`sgc-pendientes-${g}`}>
              <SgcKpiCard label={SGC_PENDING_LABELS[g]} value={data.counts[g]} color={COLORS[g]} icon={ICONS[g]} />
            </Anchor>
          </Grid.Col>
        ))}
      </Grid>
      {data.items.length > 0 && (
        <Text size='xs' c='dimmed' mt='sm'>
          Lo más reciente:{' '}
          {data.items.slice(0, 3).map((i, n) => (
            <span key={`${i.idTask}-${n}`}>
              {n > 0 ? ' · ' : ''}
              <Anchor component={Link} href={sgcHref(`${SGC_BASE_URL}/tareas/${i.idTask}`, idCompany)} size='xs'>
                #{i.idRequest} {i.task}
              </Anchor>
            </span>
          ))}
        </Text>
      )}
    </Card>
  );
}

export default function SgcPendingBoard({ idCompany }: { idCompany: number }) {
  const { data } = useSgcFetch<SgcPendingData>(`/api/sgc/pendings?company=${idCompany}`);
  if (!data) return null;
  // Las copias no controladas se suman cuando existan (Sprint 11); mientras tanto no se muestra la tarjeta vacía.
  const groups = SGC_PENDING_GROUPS.filter((g) => g !== 'copias' || data.counts.copias > 0);
  return <SgcPendingBoardView data={data} idCompany={idCompany} groups={groups} />;
}
