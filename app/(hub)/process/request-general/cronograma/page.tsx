'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, ScrollArea, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconCalendarPlus, IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { buildGrid, type CalendarItem } from '../../../../../lib/workflow/calendar';

/**
 * CRONOGRAMA ANUAL de un flujo (2026-11-26; Calidad OLP: «un calendario donde se programan las auditorías por área;
 * Calidad tiene un botón para el cronograma de cada año»). Filas = opciones del campo de grupo (p. ej. el área),
 * columnas = meses; cada solicitud se ubica por su fecha programada. «Nuevo cronograma» programa en bloque.
 */

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const color = (s: number) => (s === 2 ? 'green' : s === 3 ? 'red' : 'blue');

interface Data {
  process: string;
  configured: boolean;
  canPlan: boolean;
  companies?: number[];
  groupField?: { id: number; label: string; options: { id: number; label: string }[] } | null;
  items: CalendarItem[];
  error?: string;
}

function Contenido() {
  const sp = useSearchParams();
  const id = Number.parseInt(sp.get('id') ?? '', 10);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);

  const load = async () => {
    setError(null);
    const r = await fetch(`/api/requests-general/calendar?id=${id}&year=${year}`, { cache: 'no-store' });
    const j = (await r.json().catch(() => ({}))) as Data;
    if (!r.ok) setError(j.error || 'No se pudo cargar el cronograma');
    else setData(j);
  };
  useEffect(() => {
    if (Number.isInteger(id) && id > 0) void load();
    else setError('No se indicó el flujo.');
  }, [id, year]);

  const grid = useMemo(() => buildGrid(data?.items ?? [], year), [data, year]);
  const rows = data?.groupField ? [...data.groupField.options.map((o) => ({ id: o.id, label: o.label })), ...(grid.has(0) ? [{ id: 0, label: 'Sin área' }] : [])] : [{ id: 0, label: data?.process ?? '' }];

  return (
    <Stack gap='md' p='md' maw={1500} mx='auto'>
      <Group justify='space-between'>
        <div>
          <Anchor component={Link} href={`/process/request-general/view-workflows?id=${id}&from=workflows`} size='sm'>
            ← Volver al flujo
          </Anchor>
          <Title order={2}>Cronograma {year}</Title>
          <Text c='dimmed'>{data?.process ?? '…'}</Text>
        </div>
        <Group>
          <ActionIcon variant='default' aria-label='Año anterior' onClick={() => setYear((y) => y - 1)}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={700}>{year}</Text>
          <ActionIcon variant='default' aria-label='Año siguiente' onClick={() => setYear((y) => y + 1)}>
            <IconChevronRight size={16} />
          </ActionIcon>
          {data?.canPlan && (
            <Button leftSection={<IconCalendarPlus size={16} />} onClick={() => setPlan(true)} data-testid='cronograma-nuevo'>
              Nuevo cronograma {year}
            </Button>
          )}
        </Group>
      </Group>

      {error && <Alert color='red'>{error}</Alert>}
      {!data && !error && <Loader />}
      {data && !data.configured && <Alert color='orange'>Este flujo no tiene cronograma: en el editor del flujo, Seguimiento de fechas, elija el campo de fecha programada.</Alert>}

      {data?.configured && (
        <Card withBorder radius='md' p={0}>
          <ScrollArea>
            <Table withColumnBorders withTableBorder fz='xs' miw={1200} data-testid='cronograma-grilla'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={220}>{data.groupField?.label ?? 'Flujo'}</Table.Th>
                  {MESES.map((m) => (
                    <Table.Th key={m} ta='center'>
                      {m}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td fw={600}>{r.label}</Table.Td>
                    {MESES.map((_, mi) => {
                      const cell = grid.get(r.id)?.get(mi + 1) ?? [];
                      return (
                        <Table.Td key={mi} style={{ verticalAlign: 'top' }}>
                          <Stack gap={2}>
                            {cell.map((it) => (
                              <Tooltip key={it.id} label={`${it.subject ?? ''} · ${it.date}`}>
                                <Badge component={Link} href={`/process/request-general/view-request?id=${it.id}`} color={color(it.status_req)} variant='light' size='sm' style={{ cursor: 'pointer' }}>
                                  {it.consecutive ?? `#${it.id}`} · {it.date.slice(8, 10)}
                                </Badge>
                              </Tooltip>
                            ))}
                          </Stack>
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}
      {plan && data && <PlanModal id={id} year={year} data={data} onClose={() => setPlan(false)} onDone={() => { setPlan(false); void load(); }} />}
    </Stack>
  );
}

function PlanModal({ id, year, data, onClose, onDone }: { id: number; year: number; data: Data; onClose: () => void; onDone: () => void }) {
  const [company, setCompany] = useState<string | null>(data.companies?.[0] ? String(data.companies[0]) : null);
  const [items, setItems] = useState<{ date: string; group: string | null; subject: string }[]>([{ date: '', group: null, subject: '' }]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<(typeof items)[number]>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const groupLabel = (g: string | null) => data.groupField?.options.find((o) => String(o.id) === g)?.label ?? '';

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/requests-general/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, year, company: Number(company), items: items.map((x) => ({ date: x.date, groupOptionId: x.group ? Number(x.group) : null, subject: x.subject || `${data.process} · ${groupLabel(x.group)}`.trim() })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo programar');
      toast.success(`${j.created?.length ?? 0} programación(es) creada(s)`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo programar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size='xl' title={<Text fw={700}>Nuevo cronograma {year}</Text>} closeOnClickOutside={false}>
      <Stack gap='sm'>
        <Text size='sm' c='dimmed'>
          Cada fila crea una solicitud del flujo con su fecha programada{data.groupField ? ` y su ${data.groupField.label.toLowerCase()}` : ''}. Las tareas, el consecutivo y los avisos siguen la configuración del flujo.
        </Text>
        {(data.companies?.length ?? 0) > 1 && <Select label='Empresa' data={(data.companies ?? []).map((c) => ({ value: String(c), label: `Empresa ${c}` }))} value={company} onChange={setCompany} w={240} />}
        {items.map((x, i) => (
          <Group key={i} gap='xs' align='flex-end' wrap='nowrap'>
            <TextInput type='date' label={i === 0 ? 'Fecha' : undefined} min={`${year}-01-01`} max={`${year}-12-31`} value={x.date} onChange={(e) => set(i, { date: e.currentTarget.value })} w={170} />
            {data.groupField && (
              <Select label={i === 0 ? data.groupField.label : undefined} data={data.groupField.options.map((o) => ({ value: String(o.id), label: o.label }))} value={x.group} onChange={(v) => set(i, { group: v })} searchable w={260} />
            )}
            <TextInput label={i === 0 ? 'Asunto' : undefined} placeholder={`${data.process} · ${groupLabel(x.group)}`} value={x.subject} onChange={(e) => set(i, { subject: e.currentTarget.value })} style={{ flex: 1 }} />
            <ActionIcon variant='subtle' color='red' aria-label='Quitar' disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Group justify='space-between'>
          <Button variant='light' size='xs' leftSection={<IconPlus size={14} />} onClick={() => setItems((xs) => [...xs, { date: '', group: xs[xs.length - 1]?.group ?? null, subject: '' }])}>
            Agregar fila
          </Button>
          <Group>
            <Button variant='default' onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={!company || items.some((x) => !x.date || (data.groupField && !x.group))} onClick={() => void save()} data-testid='cronograma-programar'>
              Programar {items.length}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function CronogramaPage() {
  return (
    <Suspense fallback={<Loader m='xl' />}>
      <Contenido />
    </Suspense>
  );
}
