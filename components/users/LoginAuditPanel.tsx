'use client';

/**
 * Pestaña «Inicios de sesión» de Administración → Usuarios.
 *
 * Pedido de Nicolás Rivera (2026-10-16): ver los logins de los usuarios, de qué
 * IP y país, por auditoría de seguridad. Mismos componentes y estilos que la
 * pestaña de usuarios (Card, SimpleGrid de filtros, Table striped, Badge light,
 * Pagination) para que se vea igual al resto de SynerLink.
 *
 * Resalta:
 *   - en naranja, los ingresos desde una IP pública fuera de Colombia;
 *   - en rojo, el 3.er fallo seguido (o más) del mismo correo/NIT.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Group,
  Pagination,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCalendarEvent,
  IconCircleCheck,
  IconCircleX,
  IconDeviceDesktop,
  IconDownload,
  IconLogin2,
  IconMapPin,
  IconSearch,
  IconWorld,
} from '@tabler/icons-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import {
  FAIL_STREAK_ALERT,
  GEOIP_ATTRIBUTION,
  LOGIN_PROVIDERS,
  describeFailureReason,
} from '@/lib/auth/login-audit/constants';
import { DEFAULT_RANGE_DAYS, daysAgoInColombia, todayInColombia } from '@/lib/auth/login-audit/filters';

interface LoginAuditRow {
  id: number;
  attemptedAt: string;
  provider: string;
  identifier: string | null;
  userId: string | null;
  userName: string | null;
  success: boolean;
  failureReason: string | null;
  clientIp: string | null;
  ipScope: string;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  companies: string | null;
  failStreak: number;
  outsideHome: boolean;
}

interface ApiResponse {
  rows: LoginAuditRow[];
  summary: { total: number; failed: number; outsideHome: number; streakAlerts: number };
  pagination: { page: number; limit: number; total: number; pages: number };
  countries: Array<{ code: string; name: string; count: number }>;
  truncated?: boolean;
}

const PAGE_SIZE = 25;

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function locationLabel(row: LoginAuditRow): string {
  if (row.ipScope === 'INTERNA') return 'Red interna';
  if (!row.countryCode && !row.countryName) return 'Sin ubicación';
  const place = [row.city, row.region].filter(Boolean).join(', ');
  const country = row.countryName ?? row.countryCode ?? '';
  return place ? `${place} · ${country}` : country;
}

function deviceLabel(row: LoginAuditRow): string {
  return [row.browser, row.os, row.device].filter(Boolean).join(' · ') || 'Desconocido';
}

function providerLabel(provider: string): string {
  return (LOGIN_PROVIDERS as Record<string, string>)[provider] ?? provider;
}

function rowBackground(row: LoginAuditRow): string | undefined {
  if (row.failStreak >= FAIL_STREAK_ALERT) return 'var(--mantine-color-red-light)';
  if (row.outsideHome) return 'var(--mantine-color-orange-light)';
  return undefined;
}

function AlertBadges({ row }: { row: LoginAuditRow }) {
  return (
    <>
      {row.outsideHome && (
        <Badge color='orange' variant='light' size='xs' leftSection={<IconWorld size={10} />}>
          Fuera de Colombia
        </Badge>
      )}
      {row.failStreak >= FAIL_STREAK_ALERT && (
        <Badge color='red' variant='light' size='xs' leftSection={<IconAlertTriangle size={10} />}>
          {row.failStreak} fallos seguidos
        </Badge>
      )}
    </>
  );
}

function ResultBadge({ row, size }: { row: LoginAuditRow; size: 'xs' | 'sm' }) {
  const badge = (
    <Badge
      color={row.success ? 'green' : 'red'}
      variant='light'
      size={size}
      leftSection={row.success ? <IconCircleCheck size={11} /> : <IconCircleX size={11} />}
    >
      {row.success ? 'Exitoso' : 'Fallido'}
    </Badge>
  );
  if (row.success || !row.failureReason) return badge;
  return (
    <Tooltip label={describeFailureReason(row.failureReason)} withArrow>
      {badge}
    </Tooltip>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card withBorder radius='md' padding='sm'>
      <Text size='xs' c='dimmed'>
        {label}
      </Text>
      <Text fw={700} size='lg' c={color}>
        {value.toLocaleString('es-CO')}
      </Text>
    </Card>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  const animate = !useReducedMotion();
  return (
    <Stack gap={10} aria-hidden='true' data-testid='login-audit-esqueleto'>
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} gap='sm' wrap='nowrap'>
          <Skeleton height={12} width={130} radius='sm' animate={animate} />
          <Skeleton height={12} width={`${[22, 30, 18, 26][i % 4]}%`} radius='sm' animate={animate} />
          <Skeleton height={18} width={70} radius='xl' animate={animate} />
          <Skeleton height={12} width={100} radius='sm' animate={animate} />
          <Skeleton height={12} width={`${[16, 12, 20, 14][i % 4]}%`} radius='sm' animate={animate} />
          <Skeleton height={12} width='14%' radius='sm' animate={animate} />
        </Group>
      ))}
    </Stack>
  );
}

function SummarySkeleton() {
  const animate = !useReducedMotion();
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing='sm' mb='sm' aria-hidden='true'>
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} withBorder radius='md' padding='sm'>
          <Skeleton height={10} width='60%' radius='sm' mb={8} animate={animate} />
          <Skeleton height={18} width='35%' radius='sm' animate={animate} />
        </Card>
      ))}
    </SimpleGrid>
  );
}

export default function LoginAuditPanel() {
  const isMobile = useMediaQuery('(max-width: 768px)', true);

  const [userInput, setUserInput] = useState('');
  const [filters, setFilters] = useState({
    user: '',
    from: daysAgoInColombia(DEFAULT_RANGE_DAYS),
    to: todayInColombia(),
    country: '',
    result: '',
    provider: '',
    alerts: false,
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce del buscador, igual que en la pestaña de usuarios.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = userInput.trim();
      setFilters((prev) => (prev.user === next ? prev : { ...prev, user: next }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [userInput]);

  const buildParams = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        user: filters.user,
        from: filters.from,
        to: filters.to,
        country: filters.country,
        result: filters.result,
        provider: filters.provider,
        alerts: filters.alerts ? '1' : '',
        page: String(page),
        limit: String(PAGE_SIZE),
        ...extra,
      });
      return params;
    },
    [filters, page]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/users/login-audit?${buildParams().toString()}`, {
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || 'No se pudo cargar la auditoría de inicios de sesión');
        if (!cancelled) {
          setData(body as ApiResponse);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar la auditoría');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildParams]);

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const countryOptions = useMemo(
    () => [
      { value: '', label: 'Todos' },
      ...(data?.countries ?? []).map((c) => ({ value: c.code, label: `${c.name} (${c.count})` })),
    ],
    [data?.countries]
  );

  const exportToExcel = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/users/login-audit?${buildParams({ export: '1', page: '1' }).toString()}`, {
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as (ApiResponse & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || 'No se pudo exportar');

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Inicios de sesión');
      sheet.columns = [
        { key: 'fecha', header: 'Fecha y hora (Colombia)', width: 24 },
        { key: 'usuario', header: 'Usuario / correo intentado', width: 34 },
        { key: 'nombre', header: 'Nombre', width: 28 },
        { key: 'metodo', header: 'Método', width: 22 },
        { key: 'resultado', header: 'Resultado', width: 11 },
        { key: 'motivo', header: 'Motivo del fallo', width: 34 },
        { key: 'racha', header: 'Fallos seguidos', width: 10 },
        { key: 'ip', header: 'IP', width: 18 },
        { key: 'alcance', header: 'Red', width: 11 },
        { key: 'pais', header: 'País', width: 18 },
        { key: 'region', header: 'Región', width: 18 },
        { key: 'ciudad', header: 'Ciudad', width: 18 },
        { key: 'navegador', header: 'Navegador', width: 16 },
        { key: 'so', header: 'Sistema operativo', width: 16 },
        { key: 'dispositivo', header: 'Dispositivo', width: 12 },
        { key: 'empresas', header: 'Empresas', width: 34 },
        { key: 'alerta', header: 'Alerta', width: 26 },
        { key: 'agente', header: 'User agent', width: 60 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const row of body.rows) {
        const alerts = [
          row.outsideHome ? 'Fuera de Colombia' : '',
          row.failStreak >= FAIL_STREAK_ALERT ? `${row.failStreak} fallos seguidos` : '',
        ].filter(Boolean);
        const added = sheet.addRow({
          fecha: formatDateTime(row.attemptedAt),
          usuario: row.identifier ?? '',
          nombre: row.userName ?? '',
          metodo: providerLabel(row.provider),
          resultado: row.success ? 'Exitoso' : 'Fallido',
          motivo: row.success ? '' : describeFailureReason(row.failureReason),
          racha: row.failStreak || '',
          ip: row.clientIp ?? '',
          alcance: row.ipScope === 'INTERNA' ? 'Interna' : row.ipScope === 'PUBLICA' ? 'Pública' : 'Desconocida',
          pais: row.ipScope === 'INTERNA' ? 'Red interna' : (row.countryName ?? row.countryCode ?? ''),
          region: row.region ?? '',
          ciudad: row.city ?? '',
          navegador: row.browser ?? '',
          so: row.os ?? '',
          dispositivo: row.device ?? '',
          empresas: row.companies ?? '',
          alerta: alerts.join(' · '),
          agente: row.userAgent ?? '',
        });
        if (alerts.length) {
          added.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: row.failStreak >= FAIL_STREAK_ALERT ? 'FFFDE2E2' : 'FFFFEDD5' },
          };
        }
      }
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `inicios-de-sesion-${filters.from}-a-${filters.to}.xlsx`
      );
      if (body.truncated) {
        toast(`Se exportaron las primeras ${body.rows.length.toLocaleString('es-CO')} filas. Acote el rango de fechas para ver el resto.`);
      } else {
        toast.success('Exportación lista');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  };

  const rows = data?.rows ?? [];
  const firstLoad = loading && !data;

  return (
    <>
      <Card shadow='sm' p='md' radius='md' withBorder mb='sm'>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
          <TextInput
            label='Usuario'
            placeholder='Correo, NIT o nombre'
            leftSection={<IconSearch size={14} />}
            value={userInput}
            onChange={(e) => setUserInput(e.currentTarget.value)}
            size='sm'
          />
          <TextInput
            autoComplete='off'
            label='Desde'
            type='date'
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.currentTarget.value && setFilter('from', e.currentTarget.value)}
            leftSection={<IconCalendarEvent size={14} />}
            size='sm'
          />
          <TextInput
            autoComplete='off'
            label='Hasta'
            type='date'
            value={filters.to}
            min={filters.from}
            max={todayInColombia()}
            onChange={(e) => e.currentTarget.value && setFilter('to', e.currentTarget.value)}
            leftSection={<IconCalendarEvent size={14} />}
            size='sm'
          />
          <Select
            label='País'
            placeholder='Todos'
            data={countryOptions}
            value={filters.country}
            onChange={(value) => setFilter('country', value || '')}
            leftSection={<IconMapPin size={14} />}
            searchable
            size='sm'
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            label='Resultado'
            placeholder='Todos'
            data={[
              { value: '', label: 'Todos' },
              { value: 'ok', label: 'Exitoso' },
              { value: 'fallo', label: 'Fallido' },
            ]}
            value={filters.result}
            onChange={(value) => setFilter('result', value || '')}
            size='sm'
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            label='Método'
            placeholder='Todos'
            data={[
              { value: '', label: 'Todos' },
              ...Object.entries(LOGIN_PROVIDERS).map(([value, label]) => ({ value, label })),
            ]}
            value={filters.provider}
            onChange={(value) => setFilter('provider', value || '')}
            leftSection={<IconLogin2 size={14} />}
            size='sm'
            comboboxProps={{ withinPortal: true }}
          />
        </SimpleGrid>
        <Group justify='space-between' mt='sm' gap='xs'>
          <Checkbox
            label={`Solo alertas (fuera de Colombia o ${FAIL_STREAK_ALERT}+ fallos seguidos)`}
            checked={filters.alerts}
            onChange={(e) => setFilter('alerts', e.currentTarget.checked)}
            size='sm'
          />
          <Button
            size='sm'
            variant='light'
            leftSection={<IconDownload size={14} />}
            loading={exporting}
            disabled={!data || data.summary.total === 0}
            onClick={() => void exportToExcel()}
          >
            Exportar Excel
          </Button>
        </Group>
      </Card>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title='Error' color='red' mb='sm'>
          {error}
        </Alert>
      )}

      {firstLoad ? (
        <SummarySkeleton />
      ) : (
        data && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing='sm' mb='sm'>
            <StatCard label='Intentos' value={data.summary.total} color='blue' />
            <StatCard label='Fallidos' value={data.summary.failed} color='red' />
            <StatCard label='Fuera de Colombia' value={data.summary.outsideHome} color='orange' />
            <StatCard label={`${FAIL_STREAK_ALERT}+ fallos seguidos`} value={data.summary.streakAlerts} color='red' />
          </SimpleGrid>
        )
      )}

      <Card shadow='sm' radius='md' withBorder p='md' style={{ position: 'relative' }}>
        {loading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <Stack align='center' gap={6} py='lg'>
            <ThemeIcon size={40} radius='xl' variant='light' color='gray'>
              <IconLogin2 size={20} />
            </ThemeIcon>
            <Text size='sm' fw={500}>
              No hay inicios de sesión con estos filtros
            </Text>
            <Text size='xs' c='dimmed' ta='center'>
              Pruebe ampliando el rango de fechas o quitando filtros
            </Text>
          </Stack>
        ) : isMobile ? (
          <Stack gap='xs'>
            {rows.map((row) => (
              <Card key={row.id} withBorder radius='sm' padding='sm' style={{ backgroundColor: rowBackground(row) }}>
                <Group justify='space-between' align='flex-start' wrap='nowrap' gap='xs' mb={6}>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} size='sm' style={{ wordBreak: 'break-all' }}>
                      {row.identifier ?? 'Sin identificar'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {formatDateTime(row.attemptedAt)}
                    </Text>
                  </div>
                  <ResultBadge row={row} size='xs' />
                </Group>
                <Text size='xs'>
                  {row.clientIp ?? 'IP desconocida'} · {locationLabel(row)}
                </Text>
                <Text size='xs' c='dimmed'>
                  {deviceLabel(row)} · {providerLabel(row.provider)}
                </Text>
                {!row.success && row.failureReason && (
                  <Text size='xs' c='red'>
                    {describeFailureReason(row.failureReason)}
                  </Text>
                )}
                <Group gap={6} mt={4} wrap='wrap'>
                  <AlertBadges row={row} />
                </Group>
              </Card>
            ))}
          </Stack>
        ) : (
          <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <Table
              striped
              highlightOnHover
              stickyHeader
              verticalSpacing={6}
              horizontalSpacing='sm'
              style={{ minWidth: 1080 }}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 170 }}>Fecha y hora</Table.Th>
                  <Table.Th>Usuario</Table.Th>
                  <Table.Th style={{ width: 120 }}>Resultado</Table.Th>
                  <Table.Th style={{ width: 130 }}>IP</Table.Th>
                  <Table.Th>Ubicación</Table.Th>
                  <Table.Th>Dispositivo</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.id} style={{ backgroundColor: rowBackground(row) }}>
                    <Table.Td>
                      <Text size='sm'>{formatDateTime(row.attemptedAt)}</Text>
                      <Text size='xs' c='dimmed'>
                        {providerLabel(row.provider)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm' fw={500} style={{ wordBreak: 'break-word' }}>
                        {row.userName || row.identifier || 'Sin identificar'}
                      </Text>
                      {row.userName && row.identifier && (
                        <Text size='xs' c='dimmed' style={{ wordBreak: 'break-all' }}>
                          {row.identifier}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4} align='flex-start'>
                        <ResultBadge row={row} size='sm' />
                        <AlertBadges row={row} />
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm' ff='monospace'>
                        {row.clientIp ?? '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap='nowrap'>
                        {row.ipScope === 'INTERNA' ? (
                          <Badge color='gray' variant='light' size='sm'>
                            Red interna
                          </Badge>
                        ) : (
                          <Text size='sm'>{locationLabel(row)}</Text>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={row.userAgent ?? 'Sin user agent'} withArrow multiline w={360}>
                        <Group gap={6} wrap='nowrap'>
                          <IconDeviceDesktop size={14} style={{ flexShrink: 0 }} />
                          <Text size='sm'>{deviceLabel(row)}</Text>
                        </Group>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs' c='dimmed'>
                        {row.companies ?? '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {data && data.pagination.pages > 1 && (
          <Flex
            justify='center'
            mt='sm'
            pt='sm'
            style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
          >
            <Pagination total={data.pagination.pages} value={page} onChange={setPage} size='sm' radius='md' />
          </Flex>
        )}
      </Card>

      <Text size='xs' c='dimmed' mt='xs'>
        Horas en Colombia. La ubicación se calcula en el servidor con una base local; la IP no se envía
        a ningún servicio externo. {GEOIP_ATTRIBUTION}.
      </Text>
    </>
  );
}
