'use client';

/**
 * Gestión de la API SAP (2026-11-11): un solo listado de quiénes tienen acceso.
 * Filtros por tipo (Agentes · México · Portal · Otros), no secciones que mezclan
 * el alta. «Dar acceso» → elegir quién → rutas + lectura/escritura.
 * La reja la pone el servidor (lib/api-permissions/access.ts).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Skeleton, Switch, TextInput, useComputedColorScheme } from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconApi,
  IconBuildingStore,
  IconChevronRight,
  IconCircleCheck,
  IconEye,
  IconPencil,
  IconClockPause,
  IconKey,
  IconKeyOff,
  IconPlugConnectedX,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import { ToneChip, avatarColor, initialsOf, panelStyles as ps, toneClass } from '@/components/ui/panel/Panel';
import {
  API_ACCESS_MODE_LABELS,
  API_CLIENT_FILTERS,
  API_CLIENT_SUBJECT_LABELS,
  API_CLIENT_SELECTABLE_TYPES,
  API_CLIENT_TYPES,
  API_CLIENT_TYPE_LABELS,
  clientTypeUsesApiAccess,
  formatSubject,
  isKeyExpired,
  subjectKindOf,
  type ApiAccessMode,
  type ApiClientFilter,
  type ApiClientType,
} from '@/lib/api-permissions/constants';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { apiClientPath } from './ApiClientPage';
import { readApiClientsCache, writeApiClientsCache } from './apiClientsCache';
import { ActionSheet, TonePill, TypeIcon } from './InsetList';
import s from './apiPermissions.module.css';
import { loadPortalAccess, portalAccessSummary, type PortalAccessState } from './portalAccess';
import { formatDateTime, formatRelative, unusedFor, type ApiClientItem, type ApiClientsResponse } from './types';

const FILTER_KEY = 'kronos.permisosApi.filtro';
const MAX_COMPANY_CHIPS = 2;
const UNUSED_DAYS = 30;

function readFilter(): ApiClientFilter {
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (raw && API_CLIENT_FILTERS.some((f) => f.value === raw)) return raw as ApiClientFilter;
  } catch {
    /* sin almacenamiento */
  }
  return 'all';
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export default function ApiPermissionsPanel() {
  const isDark = useComputedColorScheme('light', { getInitialValueInEffect: true }) === 'dark';
  // Arranca con lo último conocido (al volver de la pantalla de un cliente se pinta al instante).
  const [data, setData] = useState<ApiClientsResponse | null>(() => readApiClientsCache());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ApiClientFilter>('all');
  useEffect(() => {
    setFilter(readFilter());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/administration/api-clients', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as (ApiClientsResponse & { error?: string }) | null;
      if (res.status === 401 || res.status === 403) setData(null); // sin permiso: no se muestra lo guardado
      if (!res.ok || !body) throw new Error(body?.error || 'No se pudieron cargar los clientes de API');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los clientes de API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // La lista y la pantalla del cliente comparten lo cargado (apiClientsCache.ts).
  useEffect(() => {
    writeApiClientsCache(data);
  }, [data]);

  // Deja lista de antemano la pantalla del cliente (en desarrollo, la primera vez se compila).
  useEffect(() => {
    if (!data) return;
    router.prefetch(apiClientPath('nuevo'));
    for (const c of data.clients.slice(0, 10)) router.prefetch(apiClientPath(c.id));
  }, [data, router]);

  /**
   * Pone en la lista el cliente que devolvió el servidor tras crear, editar o tocar llaves, sin
   * recargar todo (cada petición extra cuesta ~1 s en desarrollo). Si no llegó, recarga completa.
   */
  const applyClient = useCallback(
    (client: ApiClientItem | null | undefined) => {
      if (!client) {
        void load();
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        const rest = prev.clients.filter((c) => c.id !== client.id);
        const clients = [...rest, client].sort((a, b) => a.name.localeCompare(b.name, 'es'));
        return { ...prev, clients };
      });
    },
    [load]
  );

  const clients = useMemo(() => data?.clients ?? [], [data]);

  /**
   * Proveedores o clientes: lo que ven en el portal (API de la landing), en una sola consulta.
   * Sus permisos reales viven allá; sin esto la fila diría «0 permisos» aunque vean módulos.
   */
  const portalNits = useMemo(
    () =>
      [...new Set(clients.filter((c) => c.clientType === 'portal_terceros' && c.subjectRef).map((c) => c.subjectRef as string))]
        .sort()
        .join(','),
    [clients]
  );
  const [portalAccess, setPortalAccess] = useState<PortalAccessState | null>(null);
  useEffect(() => {
    if (!portalNits) {
      setPortalAccess(null);
      return;
    }
    const controller = new AbortController();
    setPortalAccess({ status: 'loading' });
    loadPortalAccess(portalNits.split(','), controller.signal)
      .then(setPortalAccess)
      .catch(() => {
        /* cancelada: se recargó la lista */
      });
    return () => controller.abort();
  }, [portalNits]);

  const companyNames = useMemo(() => new Map((data?.companies ?? []).map((c) => [c.id, c.name])), [data]);
  const agentNames = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.code, a.name])), [data]);
  const activePermissionCodes = useMemo(
    () => new Set((data?.permissions ?? []).filter((p) => p.active).map((p) => p.code)),
    [data]
  );

  const summary = useMemo(() => {
    const now = Date.now();
    const active = clients.filter((c) => c.active);
    return {
      total: clients.length,
      active: active.length,
      keys: clients.reduce((sum, c) => sum + c.keys.filter((k) => !isKeyExpired(k.expiresAt, now)).length, 0),
      unused: active.filter((c) => unusedFor(c.lastUsedAt, UNUSED_DAYS, now)).length,
    };
  }, [clients]);

  const countsByType = useMemo(() => {
    const map = new Map<ApiClientType | 'all', number>([['all', clients.length]]);
    for (const t of API_CLIENT_TYPES) map.set(t, 0);
    for (const c of clients) map.set(c.clientType, (map.get(c.clientType) ?? 0) + 1);
    return map;
  }, [clients]);

  const needle = normalize(query);
  const visibleClients = useMemo(() => {
    return [...clients]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .filter((client) => {
        if (filter !== 'all' && client.clientType !== filter) return false;
        if (!needle) return true;
        const agentName = client.agentCode ? agentNames.get(client.agentCode) ?? '' : '';
        const haystack = normalize(
          `${client.name} ${client.agentCode ?? ''} ${agentName} ${client.subjectLabel ?? ''} ${client.subjectRef ?? ''} ${API_CLIENT_TYPE_LABELS[client.clientType]}`
        );
        return haystack.includes(needle);
      });
  }, [clients, filter, needle, agentNames]);

  const pickFilter = (next: ApiClientFilter) => {
    setFilter(next);
    try {
      window.localStorage.setItem(FILTER_KEY, next);
    } catch {
      /* sin almacenamiento */
    }
  };

  // Cada cliente se abre en su propia pantalla completa (2026-11-11), ya no en un modal.
  const openClient = (client: ApiClientItem) => router.push(apiClientPath(client.id));

  /**
   * «Permitir escritura» desde la lista (2026-11-11): guarda el cliente completo con el nivel nuevo
   * (mismo PATCH del modal). Al pasar a solo lectura se quitan sus permisos de escritura, porque el
   * servidor no los acepta en ese nivel. Encender pide confirmación (accessConfirm).
   */
  const [accessConfirm, setAccessConfirm] = useState<ApiClientItem | null>(null);
  const [accessSaving, setAccessSaving] = useState<number | null>(null);
  const saveAccessMode = async (client: ApiClientItem, accessMode: ApiAccessMode) => {
    if (!data) return;
    const writeCodes = new Set(data.permissions.filter((p) => p.accessKind === 'escritura').map((p) => p.code));
    const permissionCodes = client.permissionCodes.filter(
      (code) => activePermissionCodes.has(code) && (accessMode === 'escritura' || !writeCodes.has(code))
    );
    setAccessSaving(client.id);
    try {
      const res = await fetch(`/api/administration/api-clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: client.name,
          clientType: client.clientType,
          description: client.description,
          agentCode: client.agentCode,
          subjectRef: subjectKindOf(client.clientType) ? client.subjectRef : null,
          allCompanies: client.allCompanies,
          companyIds: client.allCompanies ? [] : client.companyIds,
          permissionCodes,
          // Conserva los permisos por empresa de los que siguen marcados (si no, se perderían al guardar).
          permissionCompanies: Object.fromEntries(
            Object.entries(client.permissionCompanies ?? {}).filter(([code]) => permissionCodes.includes(code))
          ),
          active: client.active,
          accessMode,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; client?: ApiClientItem | null } | null;
      if (!res.ok) throw new Error(body?.error || 'No se pudo cambiar el nivel de acceso');
      const removed = client.permissionCodes.length - permissionCodes.length;
      toast.success(
        accessMode === 'escritura'
          ? `${client.name}: lectura y escritura`
          : removed > 0
            ? `${client.name}: solo lectura (se quitaron ${removed} ${removed === 1 ? 'permiso' : 'permisos'} de escritura)`
            : `${client.name}: solo lectura`
      );
      applyClient(body?.client);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar el nivel de acceso');
    } finally {
      setAccessSaving(null);
      setAccessConfirm(null);
    }
  };
  const openNew = () => router.push(apiClientPath('nuevo'));

  const noMatches = visibleClients.length === 0;

  /** «Portal: 9 módulos · 2 usuarios» (con las empresas al pasar el mouse), o por qué no se sabe. */
  const renderPortalMetric = (client: ApiClientItem) => {
    if (!client.subjectRef || !portalAccess) return null;
    if (portalAccess.status === 'loading') {
      return <span className={s.metric}>Consultando portal…</span>;
    }
    if (portalAccess.status !== 'ok') {
      return (
        <span title={portalAccess.message}>
          <TonePill tone='idle' icon={<IconPlugConnectedX size={12} />}>
            Portal sin conexión
          </TonePill>
        </span>
      );
    }
    const access = portalAccess.items[client.subjectRef];
    if (!access || access.empresas.length === 0) {
      return (
        <span title='No tiene usuarios activos en el portal de proveedores'>
          <TonePill tone='warning' icon={<IconAlertTriangle size={12} />}>
            Sin acceso al portal
          </TonePill>
        </span>
      );
    }
    return (
      <span className={s.metric} title={`En el portal: ${access.empresas.map((e) => e.nombre).join(', ')}`}>
        <IconBuildingStore size={14} />
        Portal: <span className={s.metricStrong}>{portalAccessSummary(access)}</span>
      </span>
    );
  };

  const renderRow = (client: ApiClientItem) => {
    const agentName = client.agentCode ? agentNames.get(client.agentCode) ?? client.agentCode : null;
    const companies = client.allCompanies ? [] : client.companyIds.map((id) => companyNames.get(id) ?? `#${id}`);
    const permissions = client.permissionCodes.filter((code) => activePermissionCodes.has(code)).length;
    const subject = formatSubject(client.clientType, client.subjectRef, client.subjectLabel);
    const subjectKind = subjectKindOf(client.clientType);
    // Proveedor o cliente: no se conecta por API, solo se muestra lo que ve en el portal.
    const usesApi = clientTypeUsesApiAccess(client.clientType);
    const liveKeys = client.keys.filter((k) => !isKeyExpired(k.expiresAt)).length;
    const onlyExpired = client.keys.length > 0 && liveKeys === 0;
    return (
      // div con rol de botón (no <button>): dentro va el interruptor de escritura, y un control no puede ir dentro de un botón.
      <div
        key={client.id}
        role='button'
        tabIndex={0}
        className={`${ps.listRowButton} ${s.clientRow}`}
        onClick={() => openClient(client)}
        onMouseEnter={() => router.prefetch(apiClientPath(client.id))}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openClient(client);
          }
        }}
      >
        {client.agentCode ? (
          <span className={ps.avatar} style={{ background: avatarColor(client.agentCode, isDark) }} aria-hidden>
            {initialsOf(agentName ?? client.name)}
          </span>
        ) : (
          <TypeIcon type={client.clientType} isDark={isDark} className={s.typeIconSmall} />
        )}
        <div className={s.rowMain}>
          <div className={s.rowTitleLine}>
            <span className={ps.rowTitle}>{client.name}</span>
            <span className={s.typeTag}>{API_CLIENT_TYPE_LABELS[client.clientType]}</span>
          </div>
          <div className={s.rowSubWrap}>
            {agentName && <span>{agentName}</span>}
            {subject && <span className={s.subjectText}>{subject}</span>}
            {!subject && subjectKind && (
              <TonePill tone='warning' icon={<IconAlertTriangle size={12} />}>
                Sin {API_CLIENT_SUBJECT_LABELS[subjectKind].toLowerCase()}
              </TonePill>
            )}
            {!usesApi ? null : client.allCompanies ? (
              <span className={s.chip}>Todas las empresas</span>
            ) : (
              <>
                {companies.slice(0, MAX_COMPANY_CHIPS).map((name, i) => (
                  <span key={`${name}-${i}`} className={s.chip} title={name}>
                    {name}
                  </span>
                ))}
                {companies.length > MAX_COMPANY_CHIPS && (
                  <span className={s.chip} title={companies.slice(MAX_COMPANY_CHIPS).join(', ')}>
                    +{companies.length - MAX_COMPANY_CHIPS}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className={s.rowSide}>
          {!usesApi && renderPortalMetric(client)}
          {usesApi && (
            <span
              className={s.accessControl}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title={API_ACCESS_MODE_LABELS[client.accessMode ?? 'lectura']}
            >
              <TonePill
                tone={client.accessMode === 'escritura' ? 'warning' : 'info'}
                icon={client.accessMode === 'escritura' ? <IconPencil size={12} /> : <IconEye size={12} />}
              >
                {client.accessMode === 'escritura' ? 'Lectura y escritura' : 'Solo lectura'}
              </TonePill>
              <Switch
                size='sm'
                aria-label={`Permitir escritura a ${client.name}`}
                checked={client.accessMode === 'escritura'}
                disabled={accessSaving === client.id}
                onChange={(e) => {
                  if (e.currentTarget.checked) setAccessConfirm(client);
                  else void saveAccessMode(client, 'lectura');
                }}
              />
            </span>
          )}
          {usesApi && (
            <span className={s.metric} title='Rutas permitidas'>
              <IconShieldCheck size={14} />
              <span className={s.metricStrong}>{permissions}</span>
              <span className={s.metricQuiet}>{permissions === 1 ? 'ruta' : 'rutas'}</span>
            </span>
          )}
          {!usesApi ? null : liveKeys === 0 ? (
            <TonePill tone={onlyExpired ? 'critical' : 'warning'} icon={<IconKeyOff size={12} />}>
              {onlyExpired ? 'Llave vencida' : 'Sin llave'}
            </TonePill>
          ) : (
            <span className={s.metric} title='Llaves activas'>
              <IconKey size={14} />
              <span className={s.metricStrong}>{liveKeys}</span>
            </span>
          )}
          {usesApi && (
            <span className={s.metricQuiet} title={client.lastUsedAt ? `Último uso: ${formatDateTime(client.lastUsedAt)}` : undefined}>
              {formatRelative(client.lastUsedAt)}
            </span>
          )}
          {usesApi && (client.active ? <ToneChip tone='ok' label='Activo' /> : <ToneChip tone='idle' label='Inactivo' />)}
        </div>
        <IconChevronRight size={16} className={ps.chevron} aria-hidden />
      </div>
    );
  };

  return (
    <div className={`${ps.root} ${s.root}`}>
      <header className={s.pageHeader}>
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <span className={ps.eyebrow}>
            <IconApi size={14} />
            API SAP
          </span>
          <h2 className={s.pageTitle}>Quiénes tienen acceso</h2>
          <p className={s.pageSub}>Agentes, México, portal u otros: rutas y lectura o escritura.</p>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew} disabled={!data} className={s.press}>
          Dar acceso
        </Button>
      </header>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title='No se pudo cargar'
          color='red'
          mb='md'
          radius='md'
        >
          {error}
          <Button size='xs' variant='light' color='red' mt='xs' leftSection={<IconRefresh size={14} />} onClick={() => void load()}>
            Reintentar
          </Button>
        </Alert>
      )}

      {loading && !data ? (
        <div className={s.stackSm}>
          <div className={s.kpiGrid} style={{ marginBottom: 0 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={58} radius={14} />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={64} radius={14} />
          ))}
        </div>
      ) : data ? (
        <>
          <div className={s.kpiGrid} role='list' aria-label='Resumen'>
            <Kpi tone='info' icon={<IconApi size={18} />} value={summary.total} label='Con acceso' />
            <Kpi tone='ok' icon={<IconCircleCheck size={18} />} value={summary.active} label='Activos' />
            <Kpi tone='info' icon={<IconKey size={18} />} value={summary.keys} label='Llaves activas' />
            <Kpi
              tone={summary.unused > 0 ? 'warning' : 'idle'}
              icon={<IconClockPause size={18} />}
              value={summary.unused}
              label={`Sin uso en ${UNUSED_DAYS} días`}
            />
          </div>

          <div className={s.toolbar}>
            <div className={s.filterRow} role='tablist' aria-label='Filtrar por tipo'>
              {API_CLIENT_FILTERS.map((f) => {
                const count = countsByType.get(f.value === 'all' ? 'all' : f.value) ?? 0;
                if (f.value !== 'all' && count === 0 && !API_CLIENT_SELECTABLE_TYPES.includes(f.value)) return null;
                const active = filter === f.value;
                return (
                  <button
                    key={f.value}
                    type='button'
                    role='tab'
                    aria-selected={active}
                    className={`${s.filterChip} ${s.press} ${active ? s.filterChipActive : ''}`}
                    onClick={() => pickFilter(f.value)}
                  >
                    {f.label}
                    <span className={s.filterCount}>{count}</span>
                  </button>
                );
              })}
            </div>
            <TextInput
              className={s.searchInToolbar}
              placeholder='Buscar…'
              aria-label='Buscar quiénes tienen acceso'
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              radius='xl'
              rightSection={
                query ? (
                  <button type='button' className={s.linkAction} onClick={() => setQuery('')} aria-label='Limpiar búsqueda'>
                    <IconX size={14} />
                  </button>
                ) : null
              }
            />
          </div>

          {portalAccess && (portalAccess.status === 'error' || portalAccess.status === 'not_configured') && (
            <Alert icon={<IconAlertTriangle size={16} />} color='yellow' mb='md' radius='md' title='No se ve lo que tienen los proveedores en el portal'>
              {portalAccess.message} Mientras tanto, la lista no puede mostrar sus módulos del portal (no quiere decir que no tengan).
            </Alert>
          )}

          {noMatches ? (
            <div className={`${ps.list} ${s.emptyCard}`}>
              <IconApi size={28} stroke={1.4} className={s.emptyIcon} />
              <div className={s.emptyTitle}>
                {needle
                  ? `Nadie coincide con «${query.trim()}»`
                  : filter === 'all'
                    ? 'Aún no hay nadie con acceso'
                    : `Nadie en ${API_CLIENT_FILTERS.find((f) => f.value === filter)?.label ?? 'este filtro'}`}
              </div>
              <p className={s.emptyHint}>
                {needle ? 'Pruebe otro término o limpie la búsqueda.' : 'Dé acceso a un agente, persona de México, portal u otro sistema.'}
              </p>
              {!needle && (
                <Button size='sm' leftSection={<IconPlus size={16} />} onClick={openNew} className={s.press} mt={4}>
                  Dar acceso
                </Button>
              )}
            </div>
          ) : (
            <div className={`${ps.list} ${s.listCard}`} role='list' aria-label='Quiénes tienen acceso'>
              {visibleClients.map(renderRow)}
            </div>
          )}
        </>
      ) : null}

      <ActionSheet
        opened={accessConfirm !== null}
        title={`¿Permitir escritura a «${accessConfirm?.name ?? ''}»?`}
        message='Podrá cambiar datos con los permisos de escritura que le marques (crear solicitudes, agregar notas, subir adjuntos…). Mientras no tenga ninguno marcado, sigue solo consultando.'
        confirmLabel='Permitir escritura'
        confirmIcon={<IconPencil size={18} />}
        destructive={false}
        loading={accessConfirm !== null && accessSaving === accessConfirm.id}
        onConfirm={() => {
          if (accessConfirm) void saveAccessMode(accessConfirm, 'escritura');
        }}
        onCancel={() => setAccessConfirm(null)}
      />

    </div>
  );
}

function Kpi({
  tone,
  icon,
  value,
  label,
}: {
  tone: 'ok' | 'warning' | 'info' | 'idle';
  icon: ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className={`${s.kpi} ${toneClass(tone)}`} role='listitem'>
      <span className={s.kpiIcon} aria-hidden>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className={s.kpiValue}>{value.toLocaleString('es-CO')}</div>
        <div className={s.kpiLabel} title={label}>
          {label}
        </div>
      </div>
    </div>
  );
}
