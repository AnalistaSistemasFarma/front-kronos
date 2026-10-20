'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ActionIcon, Button, Card, Group, SegmentedControl, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronLeft, IconChevronRight, IconCircleCheck, IconDiamondFilled, IconFlag, IconPlayerPlay, IconTarget, IconTicket } from '@tabler/icons-react';
import { longDate, monthGrid, monthLabel, SGC_WEEKDAY_LABELS, shiftMonth, weekDays } from '../../../lib/sgc/calendar';
import { agruparPorDia, ESTADO_VISUAL_COLOR, ESTADO_VISUAL_LABELS, sumarDias, TIPO_EVENTO_LABELS, type EventoCalendario, type TipoEvento } from '../../../lib/proyectos/cronograma-rules';
import { CONSULTA_ESCRITORIO } from '../ui';
import { coloresDe } from './modelo';
import css from './cronograma.module.css';

/**
 * Calendario del proyecto: Mensual, Semanal y Agenda — el MISMO patrón (y las mismas funciones
 * puras de lib/sgc/calendar.ts) del calendario de vencimientos del SGC
 * (components/sgc/vencimientos/SgcReviewCalendar.tsx), sin librerías nuevas. En el celular abre
 * en Agenda. Tocar un evento abre su detalle.
 */
type Vista = 'mes' | 'semana' | 'agenda';

const ICONO: Record<TipoEvento, ReactNode> = {
  inicio: <IconPlayerPlay size={12} />,
  fin: <IconFlag size={12} />,
  hito: <IconDiamondFilled size={12} />,
  creada: <IconTicket size={12} />,
  objetivo: <IconTarget size={12} />,
  resuelta: <IconCircleCheck size={12} />,
};

const MAX_POR_CELDA = 3;
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default function CalendarioProyecto({ eventos, hoy, onAbrir }: { eventos: EventoCalendario[]; hoy: string; onAbrir: (e: EventoCalendario) => void }) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO, undefined, { getInitialValueInEffect: false }) ?? true;
  const [vista, setVista] = useState<Vista>(() => (escritorio ? 'mes' : 'agenda'));
  const [ym, setYm] = useState(() => ({ year: Number(hoy.slice(0, 4)), month: Number(hoy.slice(5, 7)) }));
  const [semanaRef, setSemanaRef] = useState(hoy);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const porDia = useMemo(() => {
    const m = new Map<string, EventoCalendario[]>();
    for (const e of eventos) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e]);
    return m;
  }, [eventos]);
  const semana = weekDays(semanaRef);
  const inicioMes = `${ym.year}-${String(ym.month).padStart(2, '0')}-01`;
  const finMes = sumarDias(`${shiftMonth(ym.year, ym.month, 1).year}-${String(shiftMonth(ym.year, ym.month, 1).month).padStart(2, '0')}-01`, -1);
  const agenda = agruparPorDia(eventos, inicioMes, finMes);

  const mover = (d: number) => {
    if (vista === 'semana') setSemanaRef(sumarDias(semana[0], 7 * d));
    else setYm(shiftMonth(ym.year, ym.month, d));
  };
  const irAHoy = () => {
    setYm({ year: Number(hoy.slice(0, 4)), month: Number(hoy.slice(5, 7)) });
    setSemanaRef(hoy);
  };

  const chip = (e: EventoCalendario) => (
    <button
      key={e.key}
      type='button'
      className={css.chip}
      style={coloresDe(e.estado, ESTADO_VISUAL_COLOR[e.estado]) as CSSProperties}
      onClick={() => onAbrir(e)}
      title={`${TIPO_EVENTO_LABELS[e.tipo]}: ${e.titulo} (${ESTADO_VISUAL_LABELS[e.estado]})`}
      data-testid='calendario-evento'
    >
      {ICONO[e.tipo]}
      <span>{e.titulo}</span>
    </button>
  );

  const celda = (fecha: string) => {
    const lista = porDia.get(fecha) ?? [];
    const todos = abiertos.has(fecha);
    const ver = todos ? lista : lista.slice(0, MAX_POR_CELDA);
    return (
      <Stack gap={2} mt={2}>
        {ver.map(chip)}
        {lista.length > ver.length && (
          <Button size='compact-xs' variant='subtle' onClick={() => setAbiertos(new Set(abiertos).add(fecha))}>
            +{lista.length - ver.length} más
          </Button>
        )}
      </Stack>
    );
  };

  return (
    <Stack gap='sm' data-testid='cronograma-calendario'>
      <Group justify='space-between' wrap='wrap' gap='xs'>
        <SegmentedControl
          value={vista}
          onChange={(v) => setVista(v as Vista)}
          data={[
            { value: 'mes', label: 'Mes' },
            { value: 'semana', label: 'Semana' },
            { value: 'agenda', label: 'Agenda' },
          ]}
          data-testid='calendario-vista'
        />
        <Group gap={6} wrap='nowrap'>
          <ActionIcon variant='default' size={36} onClick={() => mover(-1)} aria-label='Anterior'>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Button variant='default' size='xs' h={36} onClick={irAHoy}>
            Hoy
          </Button>
          <ActionIcon variant='default' size={36} onClick={() => mover(1)} aria-label='Siguiente'>
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <Text fw={600} data-testid='calendario-titulo'>
        {vista === 'semana' ? `Semana del ${longDate(semana[0])}` : mayuscula(monthLabel(ym.year, ym.month))}
      </Text>

      {vista === 'mes' && (
        <Card withBorder radius='md' p={0} className={css.mesScroll}>
          <Table withColumnBorders layout='fixed' miw={700} data-testid='calendario-mes'>
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
              {monthGrid(ym.year, ym.month).map((w) => (
                <Table.Tr key={w[0].date}>
                  {w.map((d) => (
                    <Table.Td key={d.date} valign='top' h={96} p={4} bg={d.date === hoy ? 'var(--mantine-color-blue-light)' : undefined} style={{ opacity: d.inMonth ? 1 : 0.45 }} data-date={d.date}>
                      <Text size='xs' fw={d.date === hoy ? 700 : 400} c={d.inMonth ? undefined : 'dimmed'}>
                        {Number(d.date.slice(8))}
                      </Text>
                      {celda(d.date)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {vista === 'semana' && (
        <SimpleGrid cols={{ base: 1, sm: 7 }} spacing='xs' data-testid='calendario-semana'>
          {semana.map((d, i) => (
            <Card key={d} withBorder radius='md' p='xs' bg={d === hoy ? 'var(--mantine-color-blue-light)' : undefined} data-date={d}>
              <Text size='xs' fw={600}>
                {SGC_WEEKDAY_LABELS[i]} {Number(d.slice(8))}
                {d === hoy ? ' · hoy' : ''}
              </Text>
              {(porDia.get(d) ?? []).length === 0 ? (
                <Text size='xs' c='dimmed' mt={4}>
                  —
                </Text>
              ) : (
                celda(d)
              )}
            </Card>
          ))}
        </SimpleGrid>
      )}

      {vista === 'agenda' && (
        <Card withBorder radius='md' p='sm' data-testid='calendario-agenda'>
          {agenda.length === 0 ? (
            <Text c='dimmed' size='sm'>
              No hay eventos en {monthLabel(ym.year, ym.month)}.
            </Text>
          ) : (
            <Stack gap='md'>
              {agenda.map((g) => (
                <div key={g.fecha}>
                  <Text fw={700} size='sm' c={g.fecha === hoy ? 'blue' : g.fecha < hoy ? 'dimmed' : undefined}>
                    {longDate(g.fecha)}
                    {g.fecha === hoy ? ' · hoy' : ''}
                  </Text>
                  <Stack gap={6} mt={6}>
                    {g.eventos.map((e) => (
                      <button
                        key={e.key}
                        type='button'
                        className={css.filaAgenda}
                        style={coloresDe(e.estado, ESTADO_VISUAL_COLOR[e.estado]) as CSSProperties}
                        onClick={() => onAbrir(e)}
                        data-testid='calendario-agenda-fila'
                      >
                        <span style={{ color: `var(--mantine-color-${ESTADO_VISUAL_COLOR[e.estado]}-filled)`, display: 'flex', flexShrink: 0 }}>{ICONO[e.tipo]}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Text size='sm' fw={600} className={css.truncar}>
                            {e.titulo}
                          </Text>
                          <Text size='xs' c='dimmed' className={css.truncar}>
                            {TIPO_EVENTO_LABELS[e.tipo]} · {ESTADO_VISUAL_LABELS[e.estado]}
                          </Text>
                        </div>
                      </button>
                    ))}
                  </Stack>
                </div>
              ))}
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  );
}
