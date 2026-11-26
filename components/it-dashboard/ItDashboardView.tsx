'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconBuilding,
  IconBuildingSkyscraper,
  IconCheck,
  IconCoin,
  IconExternalLink,
  IconPackage,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { buildPieChart } from '../../lib/charts/builders';
import {
  formatTypeName,
  type CountedItem,
  type ItDashboardData,
} from '../../lib/it-dashboard/aggregate';
import type { ItAssetListItem } from '../../lib/it-dashboard/db';
import { ActividadesSection, ChartCard, KpiStatCard } from '../dashboard/actividades/ActividadesUi';
import { ChartContainer } from '../dashboard/ChartContainer';
import DashboardPageShell from '../dashboard/DashboardPageShell';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { useProjectColors } from '../dashboard/useProjectColors';
import { iconForAssetType } from './assetTypeIcons';

const ALL = 'all';

const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);
const formatMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : '—');

type AssetListResponse = { assets: ItAssetListItem[]; limit: number; truncated: boolean };

/* ------------------------------------------------------------------ */
/* Left panel: companies                                               */
/* ------------------------------------------------------------------ */

function CompanyButton({
  name,
  total,
  selected,
  color,
  onClick,
  icon: Icon,
}: {
  name: string;
  total: number;
  selected: boolean;
  color: string;
  onClick: () => void;
  icon: typeof IconBuilding;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Ver los activos de ${name}`}
      style={{
        display: 'block',
        width: '100%',
        borderRadius: 'var(--mantine-radius-md)',
        border: `1px solid ${selected ? color : 'var(--mantine-color-default-border)'}`,
        background: selected ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mantine-color-body)',
        padding: '10px 12px',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <Group justify='space-between' wrap='nowrap' gap='sm'>
        <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
          <ThemeIcon variant={selected ? 'filled' : 'light'} radius='md' size='md' style={selected ? { background: color } : { color }}>
            <Icon size={16} />
          </ThemeIcon>
          <Text size='sm' fw={selected ? 700 : 500} lineClamp={2} style={{ minWidth: 0 }}>
            {name}
          </Text>
        </Group>
        <Badge variant={selected ? 'filled' : 'light'} color={total > 0 ? 'blue' : 'gray'} style={{ flexShrink: 0 }}>
          {formatNumber(total)}
        </Badge>
      </Group>
    </UnstyledButton>
  );
}

/* ------------------------------------------------------------------ */
/* Right panel: one tile per asset type                                */
/* ------------------------------------------------------------------ */

function AssetTypeTile({
  item,
  color,
  selected,
  onClick,
}: {
  item: CountedItem;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = iconForAssetType(item.name);
  const label = formatTypeName(item.name);
  const empty = item.total === 0;
  return (
    <Tooltip label={empty ? 'Sin activos de este tipo' : `Ver los ${label.toLowerCase()}`} withArrow>
      <UnstyledButton
        onClick={onClick}
        disabled={empty}
        aria-pressed={selected}
        aria-label={`${label}: ${item.total} activos`}
        style={{
          display: 'block',
          width: '100%',
          borderRadius: 'var(--mantine-radius-md)',
          cursor: empty ? 'default' : 'pointer',
        }}
      >
        <Card
          radius='md'
          padding='md'
          withBorder
          style={{
            background: `color-mix(in srgb, ${color} ${empty ? 6 : 16}%, var(--mantine-color-body))`,
            borderColor: selected ? color : `color-mix(in srgb, ${color} 35%, transparent)`,
            borderWidth: selected ? 2 : 1,
            opacity: empty ? 0.7 : 1,
            minHeight: 112,
          }}
        >
          <Group justify='space-between' align='flex-start' wrap='nowrap'>
            <Title order={2} style={{ color, lineHeight: 1.1, fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
              {formatNumber(item.total)}
            </Title>
            <Icon size={34} stroke={1.6} color={color} />
          </Group>
          <Text size='sm' fw={600} mt='sm' style={{ color }} lineClamp={2}>
            {label}
          </Text>
        </Card>
      </UnstyledButton>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Drill-down list                                                     */
/* ------------------------------------------------------------------ */

function AssetList({
  title,
  query,
  onClose,
}: {
  title: string;
  query: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AssetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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
  }, [query]);

  return (
    <Card shadow='sm' padding='md' radius='md' withBorder>
      <Group justify='space-between' mb='sm' wrap='nowrap'>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={5}>{title}</Title>
          <Text size='xs' c='dimmed'>
            {loading
              ? 'Cargando…'
              : data
                ? `${formatNumber(data.assets.length)} activos${data.truncated ? ` (se muestran los ${formatNumber(data.limit)} más recientes)` : ''} · haga clic en uno para abrir su hoja de vida`
                : ''}
          </Text>
        </Stack>
        <Tooltip label='Cerrar el listado' withArrow>
          <ActionIcon variant='subtle' color='gray' onClick={onClose} aria-label='Cerrar el listado'>
            <IconX size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {error ? (
        <Alert icon={<IconAlertCircle size={20} />} color='red' variant='light' title='Error al cargar'>
          {error}
        </Alert>
      ) : loading ? (
        <Skeleton height={220} />
      ) : (data?.assets.length ?? 0) === 0 ? (
        <Text c='dimmed' ta='center' py='md' size='sm'>
          Sin activos para la selección
        </Text>
      ) : (
        <ScrollArea.Autosize mah={460} type='auto'>
          <Table striped highlightOnHover withTableBorder stickyHeader miw={900}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Etiqueta</Table.Th>
                <Table.Th>Serial</Table.Th>
                <Table.Th>Tipo de equipo</Table.Th>
                <Table.Th>Modelo</Table.Th>
                <Table.Th>Usuario</Table.Th>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Compra</Table.Th>
                <Table.Th aria-label='Abrir' />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data!.assets.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <Text size='sm' fw={500}>
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
                  <Table.Td>
                    <Tooltip label='Abrir la hoja de vida del activo' withArrow>
                      <ActionIcon
                        component={Link}
                        href={`/process/help-desk/view-asset?id=${a.id}`}
                        variant='subtle'
                        aria-label={`Abrir el activo ${text(a.name)}`}
                      >
                        <IconExternalLink size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Card>
  );
}

function statusColor(status: string | null): string {
  const s = (status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (s === 'en uso') return 'green';
  if (s === 'stock') return 'blue';
  if (s === 'en prestamo') return 'orange';
  if (s === 'baja') return 'red';
  return 'gray';
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ItDashboardView() {
  const { status: sessionStatus } = useSession();
  const projectColors = useProjectColors();
  const { categoricalPalette } = useDashboardChartPalette();

  const [company, setCompany] = useState<string>(ALL);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [data, setData] = useState<ItDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (company !== ALL) params.set('company', company);
    if (includeRetired) params.set('includeRetired', '1');
    return params.toString();
  }, [company, includeRetired]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-dashboard?${filterQuery}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los indicadores.');
      setData(json as ItDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }, [filterQuery]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') void load();
  }, [sessionStatus, load]);

  // A new company or filter closes the drill-down list.
  useEffect(() => {
    setSelectedType(null);
  }, [filterQuery]);

  useEffect(() => {
    if (selectedType != null) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedType]);

  const companyName =
    company === ALL
      ? 'Todas las empresas'
      : (data?.companies.find((c) => String(c.id) === company)?.name ?? 'Empresa seleccionada');

  /** Stable color per asset type (by catalogue id), so a type keeps its color across companies. */
  const typeColor = useCallback(
    (id: number) => categoricalPalette[Math.abs(id) % categoricalPalette.length],
    [categoricalPalette]
  );

  const statusPie = useMemo(
    () =>
      buildPieChart(
        (data?.byStatus ?? []).map((s, index) => ({
          name: s.name,
          value: s.total,
          color: categoricalPalette[(index + 1) % categoricalPalette.length],
        })),
        { showLegend: true, cutout: '55%' }
      ),
    [data, categoricalPalette]
  );

  const kpis = data?.kpis;
  const firstLoad = loading && !data;
  const selectedTypeItem = data?.types.find((t) => t.id === selectedType) ?? null;

  const listQuery = useMemo(() => {
    if (selectedType == null) return '';
    const params = new URLSearchParams(filterQuery);
    params.set('type', String(selectedType));
    return params.toString();
  }, [filterQuery, selectedType]);

  if (forbidden) {
    return (
      <DashboardPageShell title='Dashboard TI'>
        <Alert color='red' variant='light' icon={<IconAlertCircle size={20} />} title='Sin acceso'>
          No tiene acceso a este módulo. Si lo necesita, solicítelo al área de Tecnología.
        </Alert>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title='Dashboard TI'
      description={
        <Text size='sm' c='dimmed'>
          Inventario de activos de tecnología a partir del módulo Activos · {companyName}
        </Text>
      }
      toolbar={
        <Group gap='md' wrap='wrap'>
          <Switch
            label='Incluir activos dados de baja'
            checked={includeRetired}
            onChange={(e) => setIncludeRetired(e.currentTarget.checked)}
          />
          <Button variant='light' leftSection={<IconRefresh size={16} />} onClick={() => void load()} loading={loading}>
            Actualizar
          </Button>
        </Group>
      }
    >
      {error ? (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      ) : null}

      <Grid gutter='lg' align='flex-start'>
        {/* Left: companies */}
        <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
          <Paper withBorder radius='md' p='md' style={{ position: 'sticky', top: 16 }}>
            <Group justify='space-between' mb='sm'>
              <Title order={5}>Empresas</Title>
              <Text size='xs' c='dimmed'>
                Activos
              </Text>
            </Group>
            {firstLoad ? (
              <Stack gap='xs'>
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} height={44} radius='md' />
                ))}
              </Stack>
            ) : (
              <ScrollArea.Autosize mah='70vh' type='auto' offsetScrollbars>
                <Stack gap='xs'>
                  <CompanyButton
                    name='Todas las empresas'
                    total={data?.allCompaniesTotal ?? 0}
                    selected={company === ALL}
                    color={projectColors.primary}
                    icon={IconBuildingSkyscraper}
                    onClick={() => setCompany(ALL)}
                  />
                  {(data?.companies ?? []).map((c) => (
                    <CompanyButton
                      key={c.id}
                      name={c.name}
                      total={c.total}
                      selected={company === String(c.id)}
                      color={projectColors.primary}
                      icon={IconBuilding}
                      onClick={() => setCompany(String(c.id))}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Paper>
        </Grid.Col>

        {/* Right: indicators and asset types */}
        <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
          <Stack gap='lg'>
            <SimpleGrid cols={{ base: 1, xs: 2, xl: 4 }} spacing={{ base: 'sm', sm: 'md' }}>
              <KpiStatCard
                label='Total de activos'
                value={kpis ? formatNumber(kpis.total) : '—'}
                hint={
                  kpis
                    ? includeRetired
                      ? `Incluye ${formatNumber(kpis.retired)} dados de baja`
                      : 'Sin contar los dados de baja'
                    : ''
                }
                color={projectColors.primary}
                icon={IconPackage}
                loading={firstLoad}
                refreshing={loading && Boolean(data)}
              />
              <KpiStatCard
                label='En uso'
                value={kpis ? formatNumber(kpis.inUse) : '—'}
                hint='Asignados a un usuario'
                sharePercent={kpis && kpis.total > 0 ? (kpis.inUse / kpis.total) * 100 : 0}
                color={projectColors.success}
                icon={IconCheck}
                loading={firstLoad}
              />
              <KpiStatCard
                label='En stock y préstamo'
                value={kpis ? formatNumber(kpis.stock + kpis.onLoan) : '—'}
                hint={kpis ? `${formatNumber(kpis.stock)} en stock · ${formatNumber(kpis.onLoan)} en préstamo` : ''}
                sharePercent={kpis && kpis.total > 0 ? ((kpis.stock + kpis.onLoan) / kpis.total) * 100 : 0}
                color={projectColors.warning}
                icon={IconArrowsExchange}
                loading={firstLoad}
              />
              <KpiStatCard
                label='Valor del inventario'
                value={kpis ? formatMoney(kpis.totalCost) : '—'}
                hint='Suma del costo registrado de cada equipo'
                color={projectColors.secondary}
                icon={IconCoin}
                loading={firstLoad}
              />
            </SimpleGrid>

            <ActividadesSection
              priority={1}
              title='Activos por tipo'
              description={`${companyName} · haga clic en un tipo para ver sus activos.`}
            >
              {firstLoad ? (
                <SimpleGrid cols={{ base: 2, sm: 3, xl: 4 }} spacing='md'>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} height={112} radius='md' />
                  ))}
                </SimpleGrid>
              ) : (data?.types.length ?? 0) === 0 ? (
                <Text c='dimmed' ta='center' py='md' size='sm'>
                  No hay tipos de activo registrados
                </Text>
              ) : (
                <Box pos='relative'>
                  <SimpleGrid cols={{ base: 2, sm: 3, xl: 4 }} spacing='md'>
                    {data!.types.map((t) => (
                      <AssetTypeTile
                        key={t.id}
                        item={t}
                        color={typeColor(t.id)}
                        selected={selectedType === t.id}
                        onClick={() => setSelectedType((current) => (current === t.id ? null : t.id))}
                      />
                    ))}
                  </SimpleGrid>
                </Box>
              )}
            </ActividadesSection>

            <div ref={listRef} style={{ scrollMarginTop: 16 }}>
              {selectedType != null && selectedTypeItem ? (
                <AssetList
                  title={`${formatTypeName(selectedTypeItem.name)} · ${companyName}`}
                  query={listQuery}
                  onClose={() => setSelectedType(null)}
                />
              ) : null}
            </div>

            <ChartCard title='Activos por estado' description={companyName} height='auto' refreshing={loading && Boolean(data)}>
              {firstLoad ? (
                <Skeleton height={260} />
              ) : (data?.byStatus.length ?? 0) > 0 ? (
                <ChartContainer type='pie' data={statusPie.data} options={statusPie.options} height={260} scrollable={false} />
              ) : (
                <Flex align='center' justify='center' mih={200}>
                  <Text c='dimmed' size='sm'>
                    Sin activos
                  </Text>
                </Flex>
              )}
            </ChartCard>
          </Stack>
        </Grid.Col>
      </Grid>
    </DashboardPageShell>
  );
}
