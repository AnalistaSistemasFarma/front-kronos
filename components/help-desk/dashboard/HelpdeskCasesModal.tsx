'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconExternalLink,
  IconFilterOff,
  IconListNumbers,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import type {
  CaseBucket,
  CaseDimensionFilter,
  HelpdeskCaseDetailResult,
} from '../../../lib/help-desk/dashboard/aggregate';
import {
  countActiveFilters,
  distinctValues,
  EMPTY_CASE_FILTERS,
  filterCaseDetails,
  isSelectedCombination,
  rankCombinations,
  toggleCombination,
  withoutCombination,
  type CaseColumnFilters,
  type CaseCombination,
  type CombinationOrder,
} from '../../../lib/help-desk/dashboard/caseFilters';
import { companyRowStyle } from '../../../lib/ui/companyColors';
import { PREF_COMPANY_COLORS } from '../../../lib/ui/preferences';
import CompanyLogo from '../../ui/CompanyLogo';
import { useUiPreference } from '../../ui/useUiPreference';

export const BUCKET_TITLES: Record<CaseBucket, string> = {
  all: 'Casos en el periodo',
  resolved: 'Casos resueltos',
  pending: 'Casos pendientes',
  measured: 'Casos con tiempo de resolución',
};

const BUCKET_DESCRIPTIONS: Record<CaseBucket, string> = {
  all: 'Todos los casos creados en el periodo y la empresa seleccionados.',
  resolved: 'Casos en estado Resuelto.',
  pending: 'Casos abiertos y demás estados sin cerrar (ni Resuelto ni Cancelado).',
  measured: 'Casos resueltos con fecha de cierre: son los que entran en el tiempo medio de resolución.',
};

const DIMENSION_LABELS: Record<CaseDimensionFilter['dimension'], string> = {
  department: 'Departamento',
  technician: 'Técnico',
};

const DIMENSION_DESCRIPTIONS: Record<CaseDimensionFilter['dimension'], string> = {
  department: 'Casos reportados por este departamento.',
  technician: 'Casos asignados a este técnico.',
};

const CLOSED_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'with', label: 'Con fecha' },
  { value: 'without', label: 'Sin fecha' },
];

const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

function formatDate(isoDay: string | null): string {
  if (!isoDay) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDay}T00:00:00Z`));
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('resuelt')) return 'green';
  if (s.includes('cancel')) return 'gray';
  if (s.includes('abiert')) return 'blue';
  return 'orange';
}

function showDaysFor(bucket: CaseBucket | null): boolean {
  return bucket === 'resolved' || bucket === 'measured';
}

/** Small text filter with a clear button, for the filter row under the headers. */
function TextFilter({
  value,
  onChange,
  placeholder,
  label,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  width?: number;
}) {
  return (
    <TextInput
      size='xs'
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.currentTarget.value)}
      miw={width}
      rightSection={
        value ? (
          <ActionIcon size='xs' variant='subtle' color='gray' onClick={() => onChange('')} aria-label={`Quitar filtro de ${label}`}>
            <IconX size={12} />
          </ActionIcon>
        ) : null
      }
    />
  );
}

function ListFilter({
  value,
  onChange,
  options,
  label,
  width,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  label: string;
  width: number;
}) {
  return (
    <MultiSelect
      size='xs'
      data={options}
      value={value}
      onChange={onChange}
      placeholder={value.length ? undefined : 'Todos'}
      aria-label={`Filtrar por ${label}`}
      searchable
      clearable
      maxDropdownHeight={260}
      nothingFoundMessage='Sin coincidencias'
      miw={width}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

export default function HelpdeskCasesModal({
  bucket,
  dimension = null,
  query,
  periodLabel,
  onClose,
}: {
  /** null = closed */
  bucket: CaseBucket | null;
  /** Optional: only the cases of one department (value = label shown in the table). */
  dimension?: CaseDimensionFilter | null;
  /** Current filters as a query string (company, year, month). */
  query: string;
  periodLabel: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HelpdeskCaseDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CaseColumnFilters>(EMPTY_CASE_FILTERS);
  // Same per-user preference as the request lists (Perfil → «Distinguir compañías por color en las tablas»).
  const [companyColors] = useUiPreference<boolean>(PREF_COMPANY_COLORS, false);
  const [rankOrder, setRankOrder] = useState<CombinationOrder>('most');

  const setFilter = <K extends keyof CaseColumnFilters>(key: K, value: CaseColumnFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!bucket) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setFilters(EMPTY_CASE_FILTERS);
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams(query);
        params.set('bucket', bucket);
        if (dimension) {
          params.set('dimension', dimension.dimension);
          params.set('value', dimension.value);
        }
        const res = await fetch(`/api/help-desk/dashboard/cases?${params.toString()}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el detalle de los casos.');
        if (!cancelled) setData(json as HelpdeskCaseDetailResult);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, query, dimension]);

  const cases = useMemo(() => data?.cases ?? [], [data]);
  const visible = useMemo(() => filterCaseDetails(cases, filters), [cases, filters]);
  const activeFilters = countActiveFilters(filters);

  const options = useMemo(
    () => ({
      status: distinctValues(cases, (c) => c.status),
      company: distinctValues(cases, (c) => c.company),
      technician: distinctValues(cases, (c) => c.technician),
      category: distinctValues(cases, (c) => c.category),
      subcategory: distinctValues(cases, (c) => c.subcategory),
      activity: distinctValues(cases, (c) => c.activity),
    }),
    [cases]
  );

  /**
   * Ranking of category · subcategory · activity. It ignores the category, subcategory and
   * activity filters (it would otherwise shrink to the selected row) and keeps every other filter.
   */
  const rankingBase = useMemo(() => filterCaseDetails(cases, withoutCombination(filters)), [cases, filters]);
  const ranking = useMemo(() => rankCombinations(rankingBase, rankOrder, 10), [rankingBase, rankOrder]);
  const rankMax = Math.max(1, ...ranking.map((r) => r.total));
  const combinationActive =
    filters.category.length > 0 || filters.subcategory.length > 0 || filters.activity.length > 0;

  const applyCombination = (r: CaseCombination) => setFilters((prev) => toggleCombination(prev, r));
  const clearCombination = () => setFilters((prev) => withoutCombination(prev));
  const columnCount = showDaysFor(bucket) ? 11 : 10;

  const showDays = showDaysFor(bucket);

  return (
    <Modal
      opened={bucket != null}
      onClose={onClose}
      size='95%'
      radius='md'
      title={
        <Stack gap={2}>
          <Text fw={700} size='lg'>
            {dimension
              ? `${DIMENSION_LABELS[dimension.dimension]}: ${dimension.value}`
              : bucket
                ? BUCKET_TITLES[bucket]
                : ''}
            {data ? ` · ${formatNumber(data.total)} ${data.total === 1 ? 'caso' : 'casos'}` : ''}
          </Text>
          <Text size='xs' c='dimmed'>
            {dimension
              ? DIMENSION_DESCRIPTIONS[dimension.dimension]
              : bucket
                ? BUCKET_DESCRIPTIONS[bucket]
                : ''}{' '}
            {periodLabel}
          </Text>
        </Stack>
      }
    >
      <Stack gap='sm'>
        {error ? (
          <Alert color='red' variant='light' icon={<IconAlertCircle size={18} />} title='Error al cargar'>
            {error}
          </Alert>
        ) : null}

        {data?.truncated ? (
          <Alert color='yellow' variant='light' icon={<IconAlertCircle size={18} />}>
            Se muestran los {formatNumber(data.cases.length)} casos más recientes de {formatNumber(data.total)}.
            Use los filtros de empresa, año y mes para acotar.
          </Alert>
        ) : null}

        <Group gap='sm' wrap='nowrap' align='center'>
          <TextInput
            style={{ flex: 1 }}
            placeholder='Buscar en todas las columnas'
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            disabled={loading || !data}
          />
          <Button
            variant='light'
            color='gray'
            leftSection={<IconFilterOff size={16} />}
            onClick={() => setFilters(EMPTY_CASE_FILTERS)}
            disabled={activeFilters === 0}
          >
            Limpiar filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </Button>
        </Group>

        {loading ? (
          <Skeleton height={320} />
        ) : data && data.total === 0 ? (
          <Text c='dimmed' ta='center' py='lg' size='sm'>
            No hay casos en este indicador para los filtros seleccionados.
          </Text>
        ) : data ? (
          <>
            <Paper withBorder radius='md' p='sm'>
              <Group justify='space-between' wrap='wrap' gap='xs' mb='xs'>
                <Group gap={6} wrap='nowrap'>
                  <IconListNumbers size={18} />
                  <Text fw={600} size='sm'>
                    Categoría · subcategoría · actividad {rankOrder === 'most' ? 'que más se repite' : 'que menos se repite'}
                  </Text>
                </Group>
                <Group gap='xs' wrap='nowrap'>
                {combinationActive ? (
                  <Button
                    size='xs'
                    variant='light'
                    color='red'
                    leftSection={<IconX size={14} />}
                    onClick={clearCombination}
                  >
                    Quitar filtro y ver todos
                  </Button>
                ) : null}
                <SegmentedControl
                  size='xs'
                  value={rankOrder}
                  onChange={(v) => setRankOrder(v as CombinationOrder)}
                  data={[
                    { value: 'most', label: 'Más repetidos' },
                    { value: 'least', label: 'Menos repetidos' },
                  ]}
                />
                </Group>
              </Group>
              <Text size='xs' c='dimmed' mb='xs'>
                Sobre los {formatNumber(rankingBase.length)} casos que cumplen los demás filtros. Haga clic en una fila para ver
                solo esos casos; vuelva a hacer clic en ella (o en Quitar filtro y ver todos) para regresar a la lista completa.
              </Text>
              {ranking.length === 0 ? (
                <Text size='sm' c='dimmed' ta='center' py='xs'>
                  Sin casos para clasificar.
                </Text>
              ) : (
                <ScrollArea.Autosize mah={220} type='auto'>
                  <Table highlightOnHover verticalSpacing={4} fz='sm'>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={36}>#</Table.Th>
                        <Table.Th>Categoría</Table.Th>
                        <Table.Th>Subcategoría</Table.Th>
                        <Table.Th>Actividad</Table.Th>
                        <Table.Th ta='right'>Casos</Table.Th>
                        <Table.Th w={160}>%</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {ranking.map((r, i) => {
                        const selected = isSelectedCombination(filters, r);
                        return (
                        <Table.Tr
                          key={`${r.category}|${r.subcategory}|${r.activity}`}
                          aria-pressed={selected}
                          onClick={() => applyCombination(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              applyCombination(r);
                            }
                          }}
                          tabIndex={0}
                          role='button'
                          aria-label={
                            selected
                              ? `Quitar el filtro ${r.category}, ${r.subcategory}, ${r.activity}`
                              : `Filtrar ${r.category}, ${r.subcategory}, ${r.activity}`
                          }
                          title={selected ? 'Clic para quitar el filtro' : 'Clic para ver solo estos casos'}
                          style={{
                            cursor: 'pointer',
                            ...(selected
                              ? { background: 'var(--mantine-color-blue-light)', fontWeight: 600 }
                              : combinationActive
                                ? { opacity: 0.55 }
                                : {}),
                          }}
                        >
                          <Table.Td>
                            {selected ? (
                              <Badge size='sm' variant='filled' color='red' circle aria-hidden>
                                <IconX size={10} />
                              </Badge>
                            ) : (
                              <Badge size='sm' variant='filled' color={rankOrder === 'most' ? 'blue' : 'gray'} circle>
                                {i + 1}
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>{r.category}</Table.Td>
                          <Table.Td>{r.subcategory}</Table.Td>
                          <Table.Td>{r.activity}</Table.Td>
                          <Table.Td ta='right' fw={600}>
                            {formatNumber(r.total)}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap='nowrap'>
                              <Progress value={(r.total / rankMax) * 100} size='sm' radius='xl' style={{ flex: 1 }} />
                              <Text size='xs' c='dimmed' w={42} ta='right'>
                                {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(r.percent)} %
                              </Text>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              )}
            </Paper>

            <Text size='xs' c='dimmed'>
              {activeFilters > 0
                ? `${formatNumber(visible.length)} de ${formatNumber(cases.length)} casos cumplen los filtros`
                : `${formatNumber(cases.length)} casos · use la fila de filtros bajo cada encabezado para acotar`}
            </Text>
            <ScrollArea.Autosize mah='60vh' type='auto'>
              <Table striped={!companyColors} highlightOnHover withTableBorder stickyHeader miw={1550}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>N.º</Table.Th>
                    <Table.Th>Asunto</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Técnico</Table.Th>
                    <Table.Th>Categoría</Table.Th>
                    <Table.Th>Subcategoría</Table.Th>
                    <Table.Th>Actividad</Table.Th>
                    <Table.Th>Creado</Table.Th>
                    <Table.Th>Cierre</Table.Th>
                    {showDays ? <Table.Th ta='right'>Días</Table.Th> : null}
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>
                      <TextFilter value={filters.id} onChange={(v) => setFilter('id', v)} placeholder='N.º' label='número' width={70} />
                    </Table.Th>
                    <Table.Th>
                      <TextFilter value={filters.subject} onChange={(v) => setFilter('subject', v)} placeholder='Contiene…' label='asunto' width={180} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.status} onChange={(v) => setFilter('status', v)} options={options.status} label='estado' width={120} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.company} onChange={(v) => setFilter('company', v)} options={options.company} label='empresa' width={150} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.technician} onChange={(v) => setFilter('technician', v)} options={options.technician} label='técnico' width={150} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.category} onChange={(v) => setFilter('category', v)} options={options.category} label='categoría' width={170} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.subcategory} onChange={(v) => setFilter('subcategory', v)} options={options.subcategory} label='subcategoría' width={160} />
                    </Table.Th>
                    <Table.Th>
                      <ListFilter value={filters.activity} onChange={(v) => setFilter('activity', v)} options={options.activity} label='actividad' width={160} />
                    </Table.Th>
                    <Table.Th>
                      <Stack gap={4}>
                        <TextInput
                          size='xs'
                          type='date'
                          aria-label='Creado desde'
                          title='Desde'
                          value={filters.createdFrom}
                          onChange={(e) => setFilter('createdFrom', e.currentTarget.value)}
                        />
                        <TextInput
                          size='xs'
                          type='date'
                          aria-label='Creado hasta'
                          title='Hasta'
                          value={filters.createdTo}
                          onChange={(e) => setFilter('createdTo', e.currentTarget.value)}
                        />
                      </Stack>
                    </Table.Th>
                    <Table.Th>
                      <Select
                        size='xs'
                        data={CLOSED_OPTIONS}
                        value={filters.closed}
                        onChange={(v) => setFilter('closed', (v as CaseColumnFilters['closed']) ?? 'all')}
                        allowDeselect={false}
                        aria-label='Filtrar por fecha de cierre'
                        miw={100}
                        comboboxProps={{ withinPortal: true }}
                      />
                    </Table.Th>
                    {showDays ? (
                      <Table.Th>
                        <Group gap={4} wrap='nowrap'>
                          <TextInput
                            size='xs'
                            w={56}
                            inputMode='decimal'
                            placeholder='Mín'
                            aria-label='Días mínimo'
                            value={filters.daysMin}
                            onChange={(e) => setFilter('daysMin', e.currentTarget.value)}
                          />
                          <TextInput
                            size='xs'
                            w={56}
                            inputMode='decimal'
                            placeholder='Máx'
                            aria-label='Días máximo'
                            value={filters.daysMax}
                            onChange={(e) => setFilter('daysMax', e.currentTarget.value)}
                          />
                        </Group>
                      </Table.Th>
                    ) : null}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={columnCount}>
                        <Text c='dimmed' ta='center' py='lg' size='sm'>
                          Ningún caso cumple los filtros.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    visible.map((c) => (
                      <Table.Tr key={c.id} style={companyRowStyle(c.company, companyColors)}>
                        <Table.Td>
                          <Tooltip label='Abrir el ticket en otra pestaña'>
                            <Anchor
                              href={`/process/help-desk/view-ticket?id=${c.id}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              size='sm'
                            >
                              <Group gap={4} wrap='nowrap'>
                                {c.id}
                                <IconExternalLink size={12} />
                              </Group>
                            </Anchor>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' lineClamp={2}>
                            {c.subject}
                          </Text>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {c.department} · {c.caseType}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size='sm' variant='light' color={statusColor(c.status)}>
                            {c.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <CompanyLogo name={c.company} />
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.technician}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.category}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.subcategory}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.activity}</Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.createdAt)}</Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.endDate)}</Table.Td>
                        {showDays ? (
                          <Table.Td ta='right'>
                            {c.resolutionDays == null
                              ? '—'
                              : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(c.resolutionDays)}
                          </Table.Td>
                        ) : null}
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </>
        ) : null}
      </Stack>
    </Modal>
  );
}
