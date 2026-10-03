'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Modal, MultiSelect, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconFileSearch, IconFilePlus, IconSearch } from '@tabler/icons-react';
import { sgcHref } from '../useSgcCompany';
import { useSgcFetch } from '../useSgcFetch';
import { useSgcRowLink } from '../useSgcRowLink';
import { SGC_BASE_URL } from '../../../lib/sgc/constants';
import {
  SGC_WEEKDAY_LABELS,
  filterCalendarItems,
  groupByDate,
  longDate,
  monthGrid,
  monthLabel,
  shiftMonth,
  weekDays,
  type SgcCalendarItem,
  type SgcCalendarView,
} from '../../../lib/sgc/calendar';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';
import { addDays, SGC_CALENDAR_STATE_COLORS, SGC_CALENDAR_STATE_LABELS, type SgcCalendarState } from '../../../lib/sgc/reviewAlerts';

/**
 * CALENDARIO DE VENCIMIENTOS del SGC (pedido de Nicolás, 2026-09-30 19:42):
 * vistas mensual, semanal y agenda con la próxima fecha de vencimiento de la
 * vigencia de cada documento; colores por estado; filtros por área, proceso,
 * tipo documental, responsable y estado; «Mis vencimientos» y vista general
 * de Calidad. Desde el calendario se abre la ficha y se inicia la solicitud
 * de nueva versión en un clic.
 */

export interface SgcCalendarResponse {
  today: string;
  me: string;
  items: SgcCalendarItem[];
  canQuality: boolean;
  canManage: boolean;
  scheduler: { id: number; active: boolean; cron: string; nextRun: string | null; lastRun: string | null; lastStatus: string | null } | null;
}

const STATES: SgcCalendarState[] = ['al_dia', 'proximo', 'en_revision', 'vencido'];

function initialMonth(): { year: number; month: number } {
  if (typeof window !== 'undefined') {
    const m = /^(\d{4})-(\d{2})$/.exec(new URLSearchParams(window.location.search).get('mes') ?? '');
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  const now = new Date(Date.now() - 5 * 3600 * 1000);
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function initialView(): SgcCalendarView {
  if (typeof window === 'undefined') return 'mes';
  const v = new URLSearchParams(window.location.search).get('vista');
  if (v === 'semana' || v === 'agenda' || v === 'mes') return v;
  // En celular la cuadrícula mensual (760 px) solo mostraba lunes a miércoles: se abre en «Agenda» (revisión móvil 2026-10-03).
  return window.matchMedia?.('(max-width: 48em)').matches ? 'agenda' : 'mes';
}

function StateBadge({ state }: { state: SgcCalendarState }) {
  return (
    <Badge color={SGC_CALENDAR_STATE_COLORS[state]} variant='light' size='sm' style={{ flexShrink: 0, minWidth: 'max-content' }} data-testid='sgc-cal-estado'>
      {SGC_CALENDAR_STATE_LABELS[state]}
    </Badge>
  );
}

function ItemChip({ item, onOpen }: { item: SgcCalendarItem; onOpen: (i: SgcCalendarItem) => void }) {
  return (
    <Tooltip label={`${item.code} V${item.versionNumber ?? '-'} · ${item.title} — ${SGC_CALENDAR_STATE_LABELS[item.state]}`} withinPortal>
      <Badge
        component='button'
        type='button'
        onClick={() => onOpen(item)}
        color={SGC_CALENDAR_STATE_COLORS[item.state]}
        variant={item.state === 'vencido' ? 'filled' : 'light'}
        size='sm'
        radius='sm'
        fullWidth
        style={{ cursor: 'pointer', justifyContent: 'flex-start', textTransform: 'none' }}
        data-testid='sgc-cal-item'
        data-code={item.code}
        data-date={item.dueDate}
        data-state={item.state}
      >
        {item.code}
      </Badge>
    </Tooltip>
  );
}

export default function SgcReviewCalendar({ company }: { company: SgcCompanyAccess }) {
  const cal = useSgcFetch<SgcCalendarResponse>(`/api/sgc/review-calendar?company=${company.idCompany}`);
  const [view, setView] = useState<SgcCalendarView>(initialView);
  const [{ year, month }, setYm] = useState(initialMonth);
  const [weekRef, setWeekRef] = useState<string | null>(null);
  const [mine, setMine] = useState<boolean>(!company.canQuality);
  const [dept, setDept] = useState<string | null>(null);
  const [proc, setProc] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [resp, setResp] = useState<string | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState<SgcCalendarItem | null>(null);
  const rowLink = useSgcRowLink();

  const all = useMemo(() => cal.data?.items ?? [], [cal.data]);
  const items = useMemo(
    () =>
      filterCalendarItems(all, {
        mine,
        idDepartment: dept ? Number(dept) : null,
        idProcess: proc ? Number(proc) : null,
        idDocumentType: type ? Number(type) : null,
        responsible: resp,
        states: states as SgcCalendarState[],
        text,
      }),
    [all, mine, dept, proc, type, resp, states, text]
  );
  const byDate = useMemo(() => new Map(groupByDate(items).map((g) => [g.date, g.items])), [items]);

  if (cal.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {cal.error}
      </Alert>
    );
  }
  if (!cal.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  const today = cal.data.today;
  const week = weekDays(weekRef ?? today);
  const uniq = <T,>(pairs: [T, string][]) => [...new Map(pairs).entries()].map(([value, label]) => ({ value: String(value), label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  const counts = STATES.map((s) => [s, items.filter((i) => i.state === s).length] as const);

  const move = (delta: number) => {
    if (view === 'semana') setWeekRef(addDays(week[0], delta * 7).toISOString().slice(0, 10));
    else setYm(shiftMonth(year, month, delta));
  };
  const goToday = () => {
    const [y, m] = today.split('-').map(Number);
    setYm({ year: y, month: m });
    setWeekRef(today);
  };

  return (
    <Stack gap='md'>
      <Card withBorder radius='md' p='sm'>
        <Group justify='space-between' wrap='wrap' gap='sm'>
          <Group gap='xs'>
            <SegmentedControl
              value={view}
              onChange={(v) => setView(v as SgcCalendarView)}
              data={[
                { value: 'mes', label: 'Mensual' },
                { value: 'semana', label: 'Semanal' },
                { value: 'agenda', label: 'Agenda' },
              ]}
              data-testid='sgc-cal-vista'
            />
            {view !== 'agenda' && (
              <>
                <ActionIcon variant='default' onClick={() => move(-1)} aria-label='Anterior' data-testid='sgc-cal-anterior'>
                  <IconChevronLeft size={16} />
                </ActionIcon>
                <ActionIcon variant='default' onClick={() => move(1)} aria-label='Siguiente' data-testid='sgc-cal-siguiente'>
                  <IconChevronRight size={16} />
                </ActionIcon>
                <Button variant='default' size='xs' onClick={goToday}>
                  Hoy
                </Button>
                <Text fw={600} tt='capitalize' data-testid='sgc-cal-titulo'>
                  {view === 'mes' ? monthLabel(year, month) : `Semana del ${longDate(week[0])}`}
                </Text>
              </>
            )}
          </Group>
          <Switch label='Mis vencimientos' checked={mine} onChange={(e) => setMine(e.currentTarget.checked)} data-testid='sgc-cal-mios' />
        </Group>
        <Group gap='sm' mt='sm' wrap='wrap' align='flex-end'>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' placeholder='Código o título' leftSection={<IconSearch size={14} />} value={text} onChange={(e) => setText(e.currentTarget.value)} w={200} data-testid='sgc-cal-buscar' />
          <Select placeholder='Área' data={uniq(all.filter((i) => i.idDepartment).map((i) => [i.idDepartment!, i.department ?? `#${i.idDepartment}`]))} value={dept} onChange={setDept} clearable searchable w={190} />
          <Select placeholder='Proceso' data={uniq(all.map((i) => [i.idProcess, i.process]))} value={proc} onChange={setProc} clearable searchable w={210} data-testid='sgc-cal-proceso' />
          <Select placeholder='Tipo documental' data={uniq(all.map((i) => [i.idDocumentType, i.documentType]))} value={type} onChange={setType} clearable w={190} />
          <Select placeholder='Responsable' data={uniq(all.flatMap((i) => i.responsibles.map((r) => [r, r] as [string, string])))} value={resp} onChange={setResp} clearable searchable w={230} />
          <MultiSelect placeholder='Estado' data={STATES.map((s) => ({ value: s, label: SGC_CALENDAR_STATE_LABELS[s] }))} value={states} onChange={setStates} clearable w={230} />
        </Group>
        <Group gap='sm' mt='sm'>
          {counts.map(([s, n]) => (
            <Group key={s} gap={4}>
              <StateBadge state={s} />
              <Text size='xs' c='dimmed'>
                {n}
              </Text>
            </Group>
          ))}
          <Text size='xs' c='dimmed' data-testid='sgc-cal-conteo'>
            {items.length} documento(s) {mine ? '(míos)' : ''}
          </Text>
        </Group>
      </Card>

      {view === 'mes' && (
        <Card withBorder radius='md' p={0} style={{ overflowX: 'auto' }}>
          <Table withColumnBorders layout='fixed' miw={760} data-testid='sgc-cal-mes'>
            <Table.Thead>
              <Table.Tr>
                {SGC_WEEKDAY_LABELS.map((d) => (
                  <Table.Th key={d} ta='center'>
                    {d}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {monthGrid(year, month).map((w) => (
                <Table.Tr key={w[0].date}>
                  {w.map((day) => (
                    <Table.Td key={day.date} valign='top' h={96} bg={day.date === today ? 'var(--mantine-color-blue-light)' : undefined} style={{ opacity: day.inMonth ? 1 : 0.45 }} data-testid='sgc-cal-dia' data-date={day.date}>
                      <Text size='xs' fw={day.date === today ? 700 : 400} c={day.inMonth ? undefined : 'dimmed'}>
                        {Number(day.date.slice(8))}
                      </Text>
                      <Stack gap={2} mt={2}>
                        {(byDate.get(day.date) ?? []).map((i) => (
                          <ItemChip key={i.idDocument} item={i} onOpen={setOpen} />
                        ))}
                      </Stack>
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {view === 'semana' && (
        <SimpleGrid cols={{ base: 1, sm: 7 }} spacing='xs' data-testid='sgc-cal-semana'>
          {week.map((d, idx) => (
            <Card key={d} withBorder radius='md' p='xs' bg={d === today ? 'var(--mantine-color-blue-light)' : undefined} data-testid='sgc-cal-dia' data-date={d}>
              <Text size='xs' fw={600}>
                {SGC_WEEKDAY_LABELS[idx]} {Number(d.slice(8))}
              </Text>
              <Stack gap={4} mt={4}>
                {(byDate.get(d) ?? []).map((i) => (
                  <ItemChip key={i.idDocument} item={i} onOpen={setOpen} />
                ))}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {view === 'agenda' && (
        <Card withBorder radius='md' p='md' data-testid='sgc-cal-agenda'>
          {groupByDate(items).length === 0 ? (
            <Text c='dimmed' size='sm' data-testid='sgc-cal-vacio'>
              No hay vencimientos con estos filtros.
            </Text>
          ) : (
            <Stack gap='md'>
              {groupByDate(items).map((g) => (
                <div key={g.date}>
                  <Text fw={700} size='sm' c={g.date < today ? 'red' : undefined}>
                    {longDate(g.date)}
                    {g.date === today ? ' · hoy' : ''}
                  </Text>
                  <Stack gap={4} mt={4}>
                    {g.items.map((i) => (
                      <Group key={i.idDocument} justify='space-between' wrap='nowrap' gap='sm' data-testid='sgc-cal-agenda-fila' data-code={i.code} data-date={i.dueDate} {...rowLink(sgcHref(`${SGC_BASE_URL}/documentos/${i.idDocument}`, company.idCompany), { onOpen: () => setOpen(i) })}>
                        <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
                          <StateBadge state={i.state} />
                          <Text size='sm' ff='monospace' fw={700}>
                            {i.code} V{i.versionNumber ?? '-'}
                          </Text>
                          <Text size='sm' lineClamp={1}>
                            {i.title}
                          </Text>
                        </Group>
                        <Button size='xs' variant='subtle' onClick={() => setOpen(i)}>
                          Ver
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </div>
              ))}
            </Stack>
          )}
        </Card>
      )}

      <Modal opened={!!open} onClose={() => setOpen(null)} title='Vencimiento del documento' centered size='lg'>
        {open && (
          <Stack gap='sm' data-testid='sgc-cal-detalle'>
            <Group gap='xs'>
              <Text fw={700} ff='monospace'>
                {open.code} V{open.versionNumber ?? '-'}
              </Text>
              <StateBadge state={open.state} />
            </Group>
            <Title order={4}>{open.title}</Title>
            <SimpleGrid cols={2} spacing='xs'>
              <Text size='sm'>
                <b>Próximo vencimiento:</b> <span data-testid='sgc-cal-detalle-fecha'>{open.dueDate ? longDate(open.dueDate) : '—'}</span>
              </Text>
              <Text size='sm'>
                <b>Avisos:</b> {open.offsets.map((o) => (o === 0 ? 'el día' : `${o} d`)).join(', ')}
              </Text>
              <Text size='sm'>
                <b>Proceso:</b> {open.process}
              </Text>
              <Text size='sm'>
                <b>Área:</b> {open.department ?? '—'}
              </Text>
              <Text size='sm'>
                <b>Dueño del proceso:</b> {open.owners.join(', ') || 'sin identificar (avisa a Calidad)'}
              </Text>
              <Text size='sm'>
                <b>Último elaborador:</b> {open.lastElaborator ?? '—'}
              </Text>
            </SimpleGrid>
            {open.state === 'vencido' && (
              <Alert color='red' variant='light' icon={<IconAlertTriangle size={16} />}>
                Vencido — en revisión: el documento sigue vigente y visible, y está escalado a Aseguramiento de Calidad.
              </Alert>
            )}
            <Group justify='flex-end'>
              <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/documentos/${open.idDocument}`, company.idCompany)} variant='default' leftSection={<IconFileSearch size={16} />} data-testid='sgc-cal-abrir-ficha'>
                Abrir ficha
              </Button>
              {open.openRequestId ? (
                <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/solicitudes/${open.openRequestId}`, company.idCompany)} variant='light'>
                  Ver solicitud #{open.openRequestId}
                </Button>
              ) : (
                cal.data.canManage && (
                  <Button
                    component={Link}
                    href={sgcHref(`${SGC_BASE_URL}/solicitudes/nueva`, company.idCompany, { tipo: 'nueva_version', documento: String(open.idDocument) })}
                    leftSection={<IconFilePlus size={16} />}
                    data-testid='sgc-cal-nueva-version'
                  >
                    Iniciar nueva versión
                  </Button>
                )
              )}
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
