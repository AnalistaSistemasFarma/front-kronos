'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
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
  IconDeviceDesktop,
  IconLicense,
  IconPackage,
  IconPhone,
  IconRefresh,
  IconWorld,
} from '@tabler/icons-react';
import { buildPieChart } from '../../lib/charts/builders';
import { formatTypeName, type CountedItem, type ItDashboardData } from '../../lib/it-dashboard/aggregate';
import { ActividadesSection, ChartCard, KpiStatCard } from '../dashboard/actividades/ActividadesUi';
import { ChartContainer } from '../dashboard/ChartContainer';
import DashboardPageShell from '../dashboard/DashboardPageShell';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { useProjectColors } from '../dashboard/useProjectColors';
import AssetListModal from './AssetListModal';
import InternetPanel from './InternetPanel';
import TelephonyPanel from './TelephonyPanel';
import SoftwareModal from './SoftwareModal';
import { formatMoney, formatNumber } from './assetFormat';
import { iconForAssetType } from './assetTypeIcons';
import { companyLogoSrc } from '../ui/CompanyLogo';

const ALL = 'all';

/** Short money value for the KPI card so it never overflows: «$ 263,1 M». */
function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) =>
    `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} ${suffix}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'mil M');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  return formatMoney(n);
}

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
  const logo = Icon === IconBuildingSkyscraper ? null : companyLogoSrc(name);
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
          {logo ? (
            // Company logo from /public/landing/empresas (same files as components/ui/CompanyLogo).
            <Box
              style={{
                width: 44,
                height: 32,
                flexShrink: 0,
                borderRadius: 'var(--mantine-radius-sm)',
                background: '#fff',
                border: '1px solid var(--mantine-color-default-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logos */}
              <img src={logo} alt='' style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
            </Box>
          ) : (
            <ThemeIcon variant={selected ? 'filled' : 'light'} radius='md' size='md' style={selected ? { background: color } : { color }}>
              <Icon size={16} />
            </ThemeIcon>
          )}
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
    <Tooltip label={empty ? 'Sin activos de este tipo' : `Ver los activos de ${label.toLowerCase()}`} withArrow>
      <UnstyledButton
        onClick={onClick}
        disabled={empty}
        aria-pressed={selected}
        aria-label={`${label}: ${item.total} activos`}
        style={{
          display: 'inline-block',
          borderRadius: 'var(--mantine-radius-md)',
          cursor: empty ? 'default' : 'pointer',
        }}
      >
        {/* Compact tile: its width follows the text inside (requested 2026-11-27). */}
        <Card
          radius='md'
          px='sm'
          py={8}
          withBorder
          style={{
            background: `color-mix(in srgb, ${color} ${empty ? 6 : 16}%, var(--mantine-color-body))`,
            borderColor: selected ? color : `color-mix(in srgb, ${color} 35%, transparent)`,
            borderWidth: selected ? 2 : 1,
            opacity: empty ? 0.7 : 1,
          }}
        >
          <Group gap='xs' wrap='nowrap'>
            <Icon size={22} stroke={1.7} color={color} />
            <Text fw={800} size='lg' style={{ color, lineHeight: 1 }}>
              {formatNumber(item.total)}
            </Text>
            <Text size='sm' fw={600} style={{ color, whiteSpace: 'nowrap' }}>
              {label}
            </Text>
          </Group>
        </Card>
      </UnstyledButton>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Section buttons: Activos, Software, Proveedores                     */
/* ------------------------------------------------------------------ */

function SectionButton({
  label,
  hint,
  color,
  icon: Icon,
  onClick,
  loading,
}: {
  label: string;
  hint: string;
  color: string;
  icon: typeof IconPackage;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      aria-label={`Abrir ${label}`}
      style={{ display: 'block', width: '100%', borderRadius: 'var(--mantine-radius-md)' }}
    >
      <Card
        radius='md'
        padding='lg'
        withBorder
        style={{
          background: `color-mix(in srgb, ${color} 14%, var(--mantine-color-body))`,
          borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
          minHeight: 120,
        }}
      >
        <Group justify='space-between' align='flex-start' wrap='nowrap'>
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Title order={2} style={{ color, lineHeight: 1.1, fontSize: 'clamp(1.4rem, 2.6vw, 2rem)' }}>
              {label}
            </Title>
            {loading ? (
              <Skeleton height={12} width={120} mt={4} />
            ) : (
              <Text size='sm' c='dimmed'>
                {hint}
              </Text>
            )}
          </Stack>
          <Icon size={36} stroke={1.6} color={color} />
        </Group>
      </Card>
    </UnstyledButton>
  );
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
  const [section, setSection] = useState<'assets' | 'software' | 'providers' | null>(null);
  const [softwareCount, setSoftwareCount] = useState<number | null>(null);
  const [providerKind, setProviderKind] = useState<'internet' | 'telefonia'>('internet');

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

  const companyId = company === ALL || company === '0' ? null : Number(company);

  const loadSoftwareCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/it-dashboard/software${companyId == null ? '' : `?company=${companyId}`}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      setSoftwareCount(res.ok ? ((json.items ?? []) as unknown[]).length : null);
    } catch {
      setSoftwareCount(null);
    }
  }, [companyId]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') void loadSoftwareCount();
  }, [sessionStatus, loadSoftwareCount]);

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
                value={kpis ? formatMoneyShort(kpis.totalCost) : '—'}
                hint={kpis ? `${formatMoney(kpis.totalCost)} · suma del costo de cada equipo` : ''}
                color={projectColors.secondary}
                icon={IconCoin}
                loading={firstLoad}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
              <SectionButton
                label='Activos'
                hint={kpis ? `${formatNumber(kpis.total)} activos · ${data?.types.filter((t) => t.total > 0).length ?? 0} tipos` : ''}
                color={categoricalPalette[1 % categoricalPalette.length]}
                icon={IconDeviceDesktop}
                loading={firstLoad}
                onClick={() => setSection('assets')}
              />
              <SectionButton
                label='Software'
                hint={softwareCount == null ? 'Licencias y certificados' : `${formatNumber(softwareCount)} registros · licencias y certificados`}
                color={categoricalPalette[6 % categoricalPalette.length]}
                icon={IconLicense}
                onClick={() => setSection('software')}
              />
              <SectionButton
                label='Proveedores'
                hint='Internet y telefonía'
                color={categoricalPalette[4 % categoricalPalette.length]}
                icon={IconWorld}
                onClick={() => setSection('providers')}
              />
            </SimpleGrid>
          </Stack>
        </Grid.Col>
      </Grid>

      {/* Activos: types and status of the selected company */}
      <Modal
        opened={section === 'assets'}
        onClose={() => setSection(null)}
        size='80rem'
        radius='md'
        centered
        title={
          <Group gap='sm' wrap='nowrap'>
            <ThemeIcon variant='light' radius='md' size='lg'>
              <IconDeviceDesktop size={20} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700}>Activos</Text>
              <Text size='xs' c='dimmed'>
                {companyName}
              </Text>
            </Stack>
          </Group>
        }
      >
        <Stack gap='lg'>
            <ActividadesSection
              priority={1}
              title='Activos por tipo'
              description={`${companyName} · haga clic en un tipo para ver sus activos.`}
            >
              {firstLoad ? (
                <Group gap='sm'>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} height={40} width={150} radius='md' />
                  ))}
                </Group>
              ) : (data?.types.length ?? 0) === 0 ? (
                <Text c='dimmed' ta='center' py='md' size='sm'>
                  No hay tipos de activo registrados
                </Text>
              ) : (
                <Box pos='relative'>
                  <Group gap='sm' wrap='wrap'>
                    {data!.types.map((t) => (
                      <AssetTypeTile
                        key={t.id}
                        item={t}
                        color={typeColor(t.id)}
                        selected={selectedType === t.id}
                        onClick={() => setSelectedType(t.id)}
                      />
                    ))}
                  </Group>
                </Box>
              )}
            </ActividadesSection>

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
      </Modal>

      <SoftwareModal
        opened={section === 'software'}
        onClose={() => setSection(null)}
        companyId={companyId}
        companyName={companyName}
        companies={(data?.companies ?? []).filter((c) => c.id !== 0).map((c) => ({ id: c.id, name: c.name }))}
        onChanged={() => void loadSoftwareCount()}
      />

      {/* Proveedores: internet channel (more providers can be added here later) */}
      <Modal
        opened={section === 'providers'}
        onClose={() => setSection(null)}
        size='xl'
        radius='md'
        centered
        title={
          <Group gap='sm' wrap='nowrap'>
            <ThemeIcon variant='light' radius='md' size='lg'>
              <IconWorld size={20} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700}>Proveedores</Text>
              <Text size='xs' c='dimmed'>
                {companyName}
              </Text>
            </Stack>
          </Group>
        }
      >
        <Stack gap='sm'>
          {/* Kind of provider (requested 2026-11-27): Internet or Telefonía. */}
          <Select
            aria-label='Tipo de proveedor'
            data={[
              { value: 'internet', label: 'Internet' },
              { value: 'telefonia', label: 'Telefonía' },
            ]}
            value={providerKind}
            onChange={(v) => setProviderKind((v as 'internet' | 'telefonia') ?? 'internet')}
            allowDeselect={false}
            leftSection={providerKind === 'telefonia' ? <IconPhone size={18} /> : <IconWorld size={18} />}
            w={240}
            styles={{ input: { fontWeight: 700, fontSize: 'var(--mantine-font-size-md)' } }}
            comboboxProps={{ zIndex: 500, withinPortal: true }}
          />
          {section === 'providers' ? (
            providerKind === 'telefonia' ? (
              <TelephonyPanel companyId={companyId} />
            ) : (
              <InternetPanel companyId={companyId} />
            )
          ) : null}
        </Stack>
      </Modal>

      <AssetListModal
        opened={selectedType != null && selectedTypeItem != null}
        title={selectedTypeItem ? `${formatTypeName(selectedTypeItem.name)} · ${companyName}` : ''}
        query={listQuery}
        onClose={() => setSelectedType(null)}
      />
    </DashboardPageShell>
  );
}
