'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertCircle, IconFilterOff, IconSearch } from '@tabler/icons-react';
import type { ItAssetListItem } from '../../lib/it-dashboard/db';
import {
  EMPTY_COLUMN_FILTERS,
  columnOptions,
  filterAssetRows,
  hasActiveFilters,
  type AssetColumnFilters,
} from '../../lib/it-dashboard/listFilters';
import AssetDetailModal from './AssetDetailModal';
import { formatDate, formatNumber, statusColor, text } from './assetFormat';

type AssetListResponse = { assets: ItAssetListItem[]; limit: number; truncated: boolean };

/**
 * Preview window with every asset of the selected type (and company). Under
 * the table headers there is a filter row: text for the free columns and a
 * list for category («Tipo de equipo») and status. A click on a row opens the
 * asset detail in a second preview window.
 */
export default function AssetListModal({
  opened,
  title,
  query,
  onClose,
}: {
  opened: boolean;
  title: string;
  /** Query string for /api/it-dashboard/assets (company, type, includeRetired). */
  query: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AssetListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AssetColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [detail, setDetail] = useState<ItAssetListItem | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setFilters(EMPTY_COLUMN_FILTERS);
    fetch(`/api/it-dashboard/assets?${query}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el listado de activos.');
        if (!cancelled) setData(json as AssetListResponse);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, query]);

  const rows = useMemo(() => data?.assets ?? [], [data]);
  const filtered = useMemo(() => filterAssetRows(rows, filters), [rows, filters]);
  const categoryOptions = useMemo(() => columnOptions(rows, 'subtype'), [rows]);
  const statusOptions = useMemo(() => columnOptions(rows, 'status'), [rows]);
  const filtering = hasActiveFilters(filters);

  const set = (key: keyof AssetColumnFilters) => (value: string | null) =>
    setFilters((current) => ({ ...current, [key]: value ?? '' }));

  const textFilter = (key: keyof AssetColumnFilters, label: string) => (
    <TextInput
      size='xs'
      placeholder='Filtrar'
      aria-label={`Filtrar por ${label}`}
      leftSection={<IconSearch size={12} />}
      value={filters[key]}
      onChange={(e) => set(key)(e.currentTarget.value)}
    />
  );

  const summary = loading
    ? 'Cargando…'
    : data
      ? `${filtering ? `${formatNumber(filtered.length)} de ` : ''}${formatNumber(rows.length)} activos${
          data.truncated ? ` (se muestran los ${formatNumber(data.limit)} más recientes)` : ''
        } · haga clic en un activo para ver su detalle`
      : '';

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        size='90rem'
        radius='md'
        zIndex={300}
        centered
        title={
          <Stack gap={0}>
            <Text fw={700}>{title}</Text>
            <Text size='xs' c='dimmed'>
              {summary}
            </Text>
          </Stack>
        }
      >
        {error ? (
          <Alert icon={<IconAlertCircle size={20} />} color='red' variant='light' title='Error al cargar'>
            {error}
          </Alert>
        ) : loading || !data ? (
          <Skeleton height={320} />
        ) : rows.length === 0 ? (
          <Text c='dimmed' ta='center' py='md' size='sm'>
            Sin activos para la selección
          </Text>
        ) : (
          <Stack gap='sm'>
            {filtering ? (
              <Group justify='flex-end'>
                <Button
                  size='xs'
                  variant='subtle'
                  leftSection={<IconFilterOff size={14} />}
                  onClick={() => setFilters(EMPTY_COLUMN_FILTERS)}
                >
                  Limpiar filtros
                </Button>
              </Group>
            ) : null}
            <ScrollArea.Autosize mah='65vh' type='auto'>
              <Table striped highlightOnHover withTableBorder stickyHeader miw={1100}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Etiqueta</Table.Th>
                    <Table.Th>Serial</Table.Th>
                    <Table.Th>Categoría</Table.Th>
                    <Table.Th>Modelo</Table.Th>
                    <Table.Th>Usuario</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Compra</Table.Th>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>{textFilter('name', 'nombre')}</Table.Th>
                    <Table.Th>{textFilter('label', 'etiqueta')}</Table.Th>
                    <Table.Th>{textFilter('serial', 'serial')}</Table.Th>
                    <Table.Th>
                      <Select
                        size='xs'
                        placeholder='Todas'
                        aria-label='Filtrar por categoría'
                        data={categoryOptions}
                        value={filters.category || null}
                        onChange={set('category')}
                        clearable
                        searchable={categoryOptions.length > 6}
                        comboboxProps={{ zIndex: 500, withinPortal: true }}
                      />
                    </Table.Th>
                    <Table.Th>{textFilter('model', 'modelo')}</Table.Th>
                    <Table.Th>{textFilter('user', 'usuario o departamento')}</Table.Th>
                    <Table.Th>{textFilter('company', 'empresa')}</Table.Th>
                    <Table.Th>
                      <Select
                        size='xs'
                        placeholder='Todos'
                        aria-label='Filtrar por estado'
                        data={statusOptions}
                        value={filters.status || null}
                        onChange={set('status')}
                        clearable
                        comboboxProps={{ zIndex: 500, withinPortal: true }}
                      />
                    </Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={9}>
                        <Text c='dimmed' ta='center' py='md' size='sm'>
                          Ningún activo coincide con los filtros
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    filtered.map((a) => (
                      <Table.Tr
                        key={a.id}
                        onClick={() => setDetail(a)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetail(a);
                          }
                        }}
                        tabIndex={0}
                        role='button'
                        aria-label={`Ver el detalle de ${text(a.name)}`}
                        style={{ cursor: 'pointer' }}
                      >
                        <Table.Td>
                          <Text size='sm' fw={500} c='blue' td='underline'>
                            {text(a.name)}
                          </Text>
                        </Table.Td>
                        <Table.Td>{text(a.label)}</Table.Td>
                        <Table.Td>{text(a.serial)}</Table.Td>
                        <Table.Td>{text(a.subtype)}</Table.Td>
                        <Table.Td>{text(a.model)}</Table.Td>
                        <Table.Td>
                          <Text size='sm'>{text(a.user)}</Text>
                          {a.department ? (
                            <Text size='xs' c='dimmed'>
                              {a.department.trim()}
                            </Text>
                          ) : null}
                        </Table.Td>
                        <Table.Td>{text(a.company)}</Table.Td>
                        <Table.Td>
                          <Badge variant='light' color={statusColor(a.status)}>
                            {text(a.status)}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{formatDate(a.purchaseDate)}</Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Modal>
      <AssetDetailModal asset={detail} onClose={() => setDetail(null)} />
    </>
  );
}
