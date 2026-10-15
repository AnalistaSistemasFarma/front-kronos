'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer, Select } from '@mantine/core';
import type { ChartData } from 'chart.js';
import {
  IconCalendarCheck,
  IconChevronRight,
  IconClockExclamation,
  IconClockHour4,
  IconListCheck,
} from '@tabler/icons-react';
import { useSolicitadoData } from './SolicitadoShell';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { useChartViewport } from '../dashboard/useChartViewport';
import { ChartContainer } from '../dashboard/ChartContainer';
import { buildTeamComplianceChart } from './teamComplianceChart';
import { getFilterLabel } from '../../lib/dashboard/dateRange';
import { formatResolutionDuration } from '../../lib/request-general/solicitadoAnalytics';
import {
  LOAD_LEVEL_LABEL,
  LOAD_LEVEL_TONE,
  STALE_DAYS,
  TREND_WEEKS,
  buildTeamCompliance,
  buildTeamWorkload,
  daysSince,
  isPending,
  taskState,
  type TeamActivityRow,
  type TeamMemberSummary,
} from '../../lib/request-general/teamWorkload';
import {
  KpiTile,
  PanelCard,
  PanelSection,
  ToneChip,
  avatarColor,
  initialsOf,
  panelStyles as s,
  seriesColor,
} from '../ui/panel/Panel';

const ALL_PROCESSES = '__todos__';
const OLDEST_LIMIT = 8;

const STATE_LABEL: Record<ReturnType<typeof taskState>, string> = {
  abierta: 'Sin empezar',
  progreso: 'En progreso',
  resuelta: 'Resuelta',
  cancelada: 'Cancelada',
  borrador: 'En borrador',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function activityHref(id: number) {
  return `/process/request-general/view-activities?id=${id}`;
}

export function TeamWorkloadView() {
  const router = useRouter();
  const { teamActivities, dateRange, appliedRange, dateFilter } = useSolicitadoData();
  const viewport = useChartViewport();
  const { isDark } = useDashboardChartPalette();
  const [process, setProcess] = useState<string>(ALL_PROCESSES);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const processOptions = useMemo(() => {
    const names = new Set<string>();
    for (const a of teamActivities) if (a.process) names.add(a.process);
    return [
      { value: ALL_PROCESSES, label: 'Todos mis procesos' },
      ...[...names].sort((a, b) => a.localeCompare(b, 'es')).map((p) => ({ value: p, label: p })),
    ];
  }, [teamActivities]);

  const rows = useMemo(
    () =>
      process === ALL_PROCESSES ? teamActivities : teamActivities.filter((a) => a.process === process),
    [teamActivities, process]
  );

  const team = useMemo(() => buildTeamWorkload(rows, { range: dateRange }), [rows, dateRange]);

  const compliance = useMemo(() => buildTeamCompliance(rows, dateRange), [rows, dateRange]);
  const complianceChart = useMemo(
    () =>
      compliance.members.length > 0
        ? buildTeamComplianceChart(compliance, { isDark, compact: viewport.isCompact })
        : null,
    [compliance, isDark, viewport.isCompact]
  );

  const openColor = seriesColor(1, isDark);
  const progressColor = seriesColor(0, isDark);
  const maxPending = Math.max(1, ...team.members.map((m) => m.pending));
  const selected = team.members.find((m) => m.id === selectedId) ?? null;

  return (
    <>
      <PanelSection
        title='Resumen'
        hint={`Pendientes: hoy · Completadas: ${appliedRange}`}
      >
        <div className={s.grid4}>
          <KpiTile
            icon={<IconListCheck size={16} stroke={2} />}
            label='Pendientes'
            value={String(team.totals.pending)}
            foot={`${team.totals.open} sin empezar · ${team.totals.inProgress} en progreso`}
          />
          <KpiTile
            icon={<IconCalendarCheck size={16} stroke={2} />}
            label='Completadas'
            value={String(team.totals.completed)}
            trend={team.weeklyCompleted}
            foot={`Línea: completadas por semana (últimas ${TREND_WEEKS})`}
          />
          <KpiTile
            icon={<IconClockHour4 size={16} stroke={2} />}
            label='Tiempo promedio'
            value={team.totals.avgHours != null ? formatResolutionDuration(team.totals.avgHours) : '—'}
            textValue
            foot='Desde que inicia hasta que se resuelve'
          />
          <KpiTile
            icon={<IconClockExclamation size={16} stroke={2} />}
            label={`Más de ${STALE_DAYS} días abiertas`}
            value={String(team.totals.stale)}
            tone={team.totals.stale > 0 ? 'warning' : 'ok'}
            foot={
              team.totals.stale > 0 ? (
                <ToneChip tone='warning' label='Revisar' />
              ) : (
                <ToneChip tone='ok' label='Al día' />
              )
            }
          />
        </div>
      </PanelSection>

      <PanelSection
        title='Rendimiento por colaborador'
        hint={`${getFilterLabel(dateFilter)} · ${appliedRange}`}
      >
        <PanelCard
          title='Cumplimiento y tiempo de cierre'
          description={`Barras: % de lo asignado en el periodo que ya cerró. Línea: días promedio para cerrar (± variación). Línea roja: cumplimiento del equipo. Máx. 12 personas${
            viewport.isCompact ? ' · Toca una barra para ver el detalle' : ''
          }.`}
        >
          {complianceChart ? (
            <ChartContainer
              type='bar'
              data={complianceChart.data as ChartData<'bar'>}
              options={complianceChart.options}
              height={viewport.isCompact ? 320 : 380}
              minWidth={compliance.members.length > 6 ? compliance.members.length * 90 : undefined}
            />
          ) : (
            <div className={s.empty}>No hay actividades asignadas a tu equipo en este periodo.</div>
          )}
        </PanelCard>
      </PanelSection>

      <PanelSection
        title='Colaboradores'
        hint={plural(team.totals.members, 'persona', 'personas')}
      >
        <PanelCard
          title='Carga de cada colaborador'
          description='Actividades pendientes hoy. Toca una persona para ver sus actividades.'
          actions={
            processOptions.length > 2 ? (
              <Select
                aria-label='Filtrar por proceso'
                data={processOptions}
                value={process}
                onChange={(v) => setProcess(v ?? ALL_PROCESSES)}
                allowDeselect={false}
                radius='xl'
                size='sm'
                w={240}
                comboboxProps={{ withinPortal: true }}
              />
            ) : null
          }
        >
          <div className={s.legend}>
            <span className={s.legendItem}>
              <span className={s.swatch} style={{ background: openColor }} /> Sin empezar
            </span>
            <span className={s.legendItem}>
              <span className={s.swatch} style={{ background: progressColor }} /> En progreso
            </span>
          </div>

          {team.members.length === 0 ? (
            <div className={s.empty}>No hay actividades de colaboradores en este proceso.</div>
          ) : (
            <div className={s.list}>
              {team.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isDark={isDark}
                  maxPending={maxPending}
                  openColor={openColor}
                  progressColor={progressColor}
                  onOpen={() => setSelectedId(m.id)}
                />
              ))}
            </div>
          )}
        </PanelCard>
      </PanelSection>

      <PanelSection
        title='Pendientes más antiguas'
        hint='Las que llevan más tiempo sin cerrarse'
      >
        <PanelCard>
          {team.oldestPending.length === 0 ? (
            <div className={s.empty}>Tu equipo no tiene actividades pendientes.</div>
          ) : (
            <div className={s.list}>
              {team.oldestPending.slice(0, OLDEST_LIMIT).map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  days={a.days}
                  showPerson
                  onOpen={() => router.push(activityHref(a.id))}
                />
              ))}
            </div>
          )}
        </PanelCard>
      </PanelSection>

      <MemberSheet
        member={selected}
        rows={rows}
        range={dateRange}
        onClose={() => setSelectedId(null)}
        onOpenActivity={(id) => router.push(activityHref(id))}
      />
    </>
  );
}

function MemberRow({
  member: m,
  isDark,
  maxPending,
  openColor,
  progressColor,
  onOpen,
}: {
  member: TeamMemberSummary;
  isDark: boolean;
  maxPending: number;
  openColor: string;
  progressColor: string;
  onOpen: () => void;
}) {
  const sub = [
    m.completed > 0 ? `${plural(m.completed, 'completada', 'completadas')} en el periodo` : 'Ninguna completada en el periodo',
    m.stale > 0 ? `${m.stale} con más de ${STALE_DAYS} días` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button type='button' className={`${s.listRowButton} ${s.personRow}`} onClick={onOpen}>
      <span className={s.avatar} style={{ background: avatarColor(m.email ?? m.id, isDark) }} aria-hidden>
        {initialsOf(m.name)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className={s.rowTitle} style={{ display: 'block' }}>
          {m.name}
        </span>
        <span className={s.rowSub} style={{ display: 'block' }}>
          {sub}
        </span>
        <span
          className={s.shareTrack}
          role='img'
          aria-label={`${m.open} sin empezar y ${m.inProgress} en progreso`}
        >
          <span className={s.shareFill} style={{ width: `${(m.open / maxPending) * 100}%`, background: openColor }} />
          <span
            className={s.shareFill}
            style={{ width: `${(m.inProgress / maxPending) * 100}%`, background: progressColor }}
          />
        </span>
      </span>
      <span className={s.rowMetric}>
        {m.pending}
        <span className={s.rowMetricSub} style={{ display: 'block' }}>{m.pending === 1 ? 'pendiente' : 'pendientes'}</span>
      </span>
      <span className={s.personChip}>
        <ToneChip tone={LOAD_LEVEL_TONE[m.level]} label={LOAD_LEVEL_LABEL[m.level]} />
      </span>
      <IconChevronRight size={16} className={s.chevron} aria-hidden />
    </button>
  );
}

function ActivityRow({
  activity: a,
  days,
  showPerson,
  onOpen,
}: {
  activity: TeamActivityRow;
  days: number | null;
  showPerson?: boolean;
  onOpen: () => void;
}) {
  const state = taskState(a);
  const pending = isPending(a);
  const meta = [`Solicitud #${a.id_request_general}`, a.process, showPerson ? a.assigned : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <button type='button' className={s.listRowButton} onClick={onOpen}>
      <span style={{ minWidth: 0 }}>
        <span className={s.rowTitle} style={{ display: 'block' }}>
          {a.task || 'Actividad sin nombre'}
        </span>
        <span className={s.rowSub} style={{ display: 'block' }}>
          {meta}
        </span>
      </span>
      <span className={s.rowMetric}>
        {pending && days != null ? (
          <>
            {plural(days, 'día', 'días')}
            <span className={s.rowMetricSub} style={{ display: 'block' }}>{STATE_LABEL[state]}</span>
          </>
        ) : (
          <ToneChip tone={state === 'resuelta' ? 'ok' : 'idle'} label={STATE_LABEL[state]} />
        )}
      </span>
      <IconChevronRight size={16} className={s.chevron} aria-hidden />
    </button>
  );
}

function MemberSheet({
  member,
  rows,
  range,
  onClose,
  onOpenActivity,
}: {
  member: TeamMemberSummary | null;
  rows: TeamActivityRow[];
  range: { startDate: string; endDate: string } | null;
  onClose: () => void;
  onOpenActivity: (id: number) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const { pending, completed } = useMemo(() => {
    if (!member) return { pending: [], completed: [] };
    const mine = rows.filter((r) => r.id_assigned === member.id && taskState(r) !== 'borrador');
    const inRange = (value?: string | null) => {
      if (!range) return true;
      const key = String(value ?? '').slice(0, 10);
      return key >= range.startDate && key <= range.endDate;
    };
    return {
      pending: mine
        .filter(isPending)
        .map((r) => ({ row: r, days: daysSince(r.start_date, now) }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
      completed: mine.filter((r) => taskState(r) === 'resuelta' && inRange(r.date_resolution)),
    };
  }, [member, rows, range, now]);

  return (
    <Drawer
      opened={member != null}
      onClose={onClose}
      position='right'
      size='lg'
      radius='lg'
      offset={8}
      title={member?.name ?? ''}
      overlayProps={{ backgroundOpacity: 0.3, blur: 3 }}
      classNames={{ content: s.sheet, header: s.sheetHeader }}
    >
      {member ? (
        <div className={s.root} style={{ background: 'transparent' }}>
          <div className={s.sheetStats}>
            <div className={s.sheetStat}>
              <div className={s.sheetStatLabel}>Pendientes</div>
              <div className={s.sheetStatValue}>{member.pending}</div>
            </div>
            <div className={s.sheetStat}>
              <div className={s.sheetStatLabel}>Completadas en el periodo</div>
              <div className={s.sheetStatValue}>{member.completed}</div>
            </div>
            <div className={s.sheetStat}>
              <div className={s.sheetStatLabel}>Tiempo promedio</div>
              <div className={s.sheetStatValue}>
                {member.avgHours != null ? formatResolutionDuration(member.avgHours) : '—'}
              </div>
            </div>
            <div className={s.sheetStat}>
              <div className={s.sheetStatLabel}>Pendiente más antigua</div>
              <div className={s.sheetStatValue}>
                {member.oldestPendingDays != null ? plural(member.oldestPendingDays, 'día', 'días') : '—'}
              </div>
            </div>
          </div>

          <h3 className={s.cardTitle}>Pendientes</h3>
          <p className={s.cardHint}>De la más antigua a la más reciente.</p>
          {pending.length === 0 ? (
            <div className={s.empty}>No tiene actividades pendientes.</div>
          ) : (
            <div className={s.list}>
              {pending.map(({ row, days }) => (
                <ActivityRow key={row.id} activity={row} days={days} onOpen={() => onOpenActivity(row.id)} />
              ))}
            </div>
          )}

          <h3 className={s.cardTitle} style={{ marginTop: 22 }}>
            Completadas en el periodo
          </h3>
          <p className={s.cardHint}>{plural(completed.length, 'actividad', 'actividades')}.</p>
          {completed.length > 0 ? (
            <div className={s.list}>
              {completed.map((row) => (
                <ActivityRow key={row.id} activity={row} days={null} onOpen={() => onOpenActivity(row.id)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
