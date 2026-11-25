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
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconExternalLink, IconFilterOff, IconSearch, IconX } from '@tabler/icons-react';
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
  type CaseColumnFilters,
} from '../../../lib/help-desk/dashboard/caseFilters';

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
    }),
    [cases]
  );

  const showDays = bucket === 'resolved' || bucket === 'measured';

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
              ? `Casos reportados por este ${DIMENSION_LABELS[dimension.dimension].toLowerCase()}.`
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
            <Text size='xs' c='dimmed'>
              {activeFilters > 0
                ? `${formatNumber(visible.length)} de ${formatNumber(cases.length)} casos cumplen los filtros`
                : `${formatNumber(cases.length)} casos · use la fila de filtros bajo cada encabezado para acotar`}
            </Text>
            <ScrollArea.Autosize mah='60vh' type='auto'>
              <Table striped highlightOnHover withTableBorder stickyHeader miw={1250}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>N.º</Table.Th>
                    <Table.Th>Asunto</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Técnico</Table.Th>
                    <Table.Th>Categoría</Table.Th>
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
                      <Table.Td colSpan={showDays ? 9 : 8}>
                        <Text c='dimmed' ta='center' py='lg' size='sm'>
                          Ningún caso cumple los filtros.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    visible.map((c) => (
                      <Table.Tr key={c.id}>
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
                          <Text size='sm'>{c.company}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.technician}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{c.category}</Text>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {c.subcategory} · {c.activity}
                          </Text>
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
