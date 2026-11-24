'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Group,
  Modal,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconExternalLink, IconSearch } from '@tabler/icons-react';
import type {
  CaseBucket,
  HelpdeskCaseDetail,
  HelpdeskCaseDetailResult,
} from '../../../lib/help-desk/dashboard/aggregate';

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

function matchesSearch(c: HelpdeskCaseDetail, term: string): boolean {
  if (!term) return true;
  const haystack = [
    String(c.id),
    c.subject,
    c.status,
    c.company,
    c.department,
    c.technician,
    c.category,
    c.subcategory,
    c.activity,
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return haystack.includes(term);
}

export default function HelpdeskCasesModal({
  bucket,
  query,
  periodLabel,
  onClose,
}: {
  /** null = closed */
  bucket: CaseBucket | null;
  /** Current filters as a query string (company, year, month). */
  query: string;
  periodLabel: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HelpdeskCaseDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!bucket) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setSearch('');
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams(query);
        params.set('bucket', bucket);
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
  }, [bucket, query]);

  const term = search.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const visible = useMemo(() => (data?.cases ?? []).filter((c) => matchesSearch(c, term)), [data, term]);
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
            {bucket ? BUCKET_TITLES[bucket] : ''}
            {data ? ` · ${formatNumber(data.total)}` : ''}
          </Text>
          <Text size='xs' c='dimmed'>
            {bucket ? BUCKET_DESCRIPTIONS[bucket] : ''} {periodLabel}
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

        <TextInput
          placeholder='Buscar por número, asunto, empresa, técnico o categoría'
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          disabled={loading || !data}
        />

        {loading ? (
          <Skeleton height={320} />
        ) : data && visible.length === 0 ? (
          <Text c='dimmed' ta='center' py='lg' size='sm'>
            {data.total === 0 ? 'No hay casos en este indicador para los filtros seleccionados.' : 'Ningún caso coincide con la búsqueda.'}
          </Text>
        ) : data ? (
          <>
            {term ? (
              <Text size='xs' c='dimmed'>
                {formatNumber(visible.length)} de {formatNumber(data.cases.length)} casos coinciden con la búsqueda
              </Text>
            ) : null}
            <ScrollArea.Autosize mah='60vh' type='auto'>
              <Table striped highlightOnHover withTableBorder stickyHeader miw={1000}>
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
                </Table.Thead>
                <Table.Tbody>
                  {visible.map((c) => (
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
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </>
        ) : null}
      </Stack>
    </Modal>
  );
}
