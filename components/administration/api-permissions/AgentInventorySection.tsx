'use client';

/**
 * «Lo que tiene hoy» (solo lectura): el último inventario escaneado del agente
 * frente a lo autorizado en el cliente que se está editando. Se carga al abrir
 * la sección (GET /api/administration/api-clients/agents/[code]/inventory) y
 * las alertas se recalculan con el formulario en vivo (inventory-rules.ts).
 * Diseño (2026-11-09): listas agrupadas tipo Ajustes, igual que el resto del modal.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Collapse, Loader, Tooltip } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconClock,
  IconDeviceLaptop,
  IconEye,
  IconHelpCircle,
  IconInfoCircle,
  IconPencil,
  IconPlugConnected,
  IconRadar,
  IconRefresh,
  IconServer,
  IconShieldCheck,
  IconShieldOff,
} from '@tabler/icons-react';
import { panelStyles as ps, toneClass, type StatusTone } from '@/components/ui/panel/Panel';
import {
  CONNECTOR_CLASSES,
  CONNECTOR_CLASS_LABELS,
  inventoryAlerts,
  type AgentInventoryView,
  type AuthorizedClient,
  type ConnectorClass,
  type InventoryAlertSeverity,
} from '@/lib/api-permissions/inventory-rules';
import { InsetGroup, TonePill } from './InsetList';
import s from './apiPermissions.module.css';
import { formatDateTime, type CompanyItem } from './types';

interface Props {
  agentCode: string;
  /** Lo autorizado según el formulario (guardado o no). */
  authorized: AuthorizedClient;
  companies: CompanyItem[];
}

const CLASS_STYLE: Record<ConnectorClass, { tone: StatusTone; icon: typeof IconServer }> = {
  synerlink: { tone: 'ok', icon: IconPlugConnected },
  gss: { tone: 'info', icon: IconServer },
  local: { tone: 'idle', icon: IconDeviceLaptop },
};

const SEVERITY_STYLE: Record<InventoryAlertSeverity, { tone: StatusTone; icon: typeof IconInfoCircle; label: string }> = {
  alta: { tone: 'critical', icon: IconAlertTriangle, label: 'Revisar' },
  media: { tone: 'warning', icon: IconAlertTriangle, label: 'Atención' },
  info: { tone: 'info', icon: IconInfoCircle, label: 'Para saber' },
};

const EXEC_MODE_LABELS: Record<string, string> = {
  'sin-aprobacion': 'Ejecuta sin aprobación',
  'con-aprobacion': 'Pide aprobación',
  restringido: 'Restringido',
  desconocido: 'Desconocido',
};

const SERVICE_LABELS: Record<string, string> = {
  activo: 'Activo',
  detenido: 'Detenido',
  'sin-servicio': 'Sin servicio',
  desconocido: 'Desconocido',
};

function AccessPill({ access }: { access: string }) {
  if (access === 'escritura') {
    return (
      <TonePill tone='warning' icon={<IconPencil size={11} />}>
        Escritura
      </TonePill>
    );
  }
  if (access === 'lectura') {
    return (
      <TonePill tone='idle' icon={<IconEye size={11} />}>
        Lectura
      </TonePill>
    );
  }
  return (
    <TonePill tone='idle' icon={<IconHelpCircle size={11} />}>
      Desconocido
    </TonePill>
  );
}

function daysAgo(value: string): string {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return '';
  if (days === 0) return 'hoy';
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** Fila etiqueta → valor. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.kvRow}>
      <span className={s.kvLabel}>{label}</span>
      <span className={s.kvValue}>{children}</span>
    </div>
  );
}

export default function AgentInventorySection({ agentCode, authorized, companies }: Props) {
  const reduceMotion = useReducedMotion();
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<AgentInventoryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Otro agente: se descarta lo cargado.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [agentCode]);

  useEffect(() => {
    if (!opened || !agentCode) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/administration/api-clients/agents/${encodeURIComponent(agentCode)}/inventory`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (AgentInventoryView & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error || 'No se pudo cargar el inventario');
        setData(body);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el inventario');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [opened, agentCode, reloadTick]);

  const companyNames = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const alerts = useMemo(
    () => (data ? inventoryAlerts(data, authorized, companyNames) : []),
    [data, authorized, companyNames]
  );

  const scan = data?.scan ?? null;
  const execWithoutApproval = !!scan && (scan.execRequiresApproval === false || scan.execMode === 'sin-aprobacion');

  return (
    <InsetGroup label='Lo que tiene hoy' bare>
      <div className={s.stackSm}>
        <div className={s.card}>
          <button
            type='button'
            className={`${s.disclosure} ${s.disclosureWide}`}
            aria-expanded={opened}
            aria-controls='api-client-inventory'
            onClick={() => setOpened((v) => !v)}
          >
            <span className={`${s.keyIcon} ${toneClass('info')}`} style={{ color: 'var(--tone-ink)' }} aria-hidden>
              <IconRadar size={18} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className={s.accTitle} style={{ display: 'block' }}>
                Inventario del agente
              </span>
              <span className={s.rowHint}>Último escaneo frente a lo autorizado aquí. Solo lectura.</span>
            </span>
            <IconChevronRight size={18} className={`${s.chevronRotate} ${opened ? s.chevronOpen : ''}`} aria-hidden />
          </button>
        </div>

        <Collapse
          in={opened}
          id='api-client-inventory'
          transitionDuration={reduceMotion ? 0 : 280}
          transitionTimingFunction='cubic-bezier(0.22, 1, 0.36, 1)'
        >
          <div className={s.stackSm}>
            {loading && (
              <div className={s.card}>
                <div className={s.alertRow}>
                  <Loader size='xs' />
                  <span className={s.rowHint}>Cargando inventario…</span>
                </div>
              </div>
            )}

            {error && !loading && (
              <div className={`${s.card} ${toneClass('critical')}`} role='alert'>
                <div className={s.alertRow}>
                  <span className={s.toneIcon} aria-hidden>
                    <IconAlertTriangle size={16} />
                  </span>
                  <div>
                    <div>{error}</div>
                    <Button
                      size='xs'
                      variant='light'
                      mt={6}
                      leftSection={<IconRefresh size={12} />}
                      onClick={() => setReloadTick((t) => t + 1)}
                    >
                      Reintentar
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {data && !loading && (
              <>
                {/* Alertas arriba, cada una con ícono de tono + texto */}
                <InsetGroup label='Alertas' trailing={alerts.length > 0 ? `${alerts.length}` : undefined}>
                  {alerts.length > 0 ? (
                    alerts.map((a, i) => {
                      const style = SEVERITY_STYLE[a.severity];
                      const Icon = style.icon;
                      return (
                        <div key={`${a.code}-${i}`} className={`${s.alertRow} ${toneClass(style.tone)}`}>
                          <span className={s.toneIcon} aria-hidden>
                            <Icon size={16} />
                          </span>
                          <div>
                            <span className={s.alertLabel}>{style.label}:</span> {a.message}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className={`${s.alertRow} ${toneClass('ok')}`}>
                      <span className={s.toneIcon} aria-hidden>
                        <IconShieldCheck size={16} />
                      </span>
                      <div>
                        <span className={s.alertLabel}>Sin alertas</span>
                      </div>
                    </div>
                  )}
                </InsetGroup>

                {/* Datos del escaneo y del agente */}
                <InsetGroup label='Datos'>
                  {!scan ? (
                    <Field label='Último escaneo'>Este agente aún no tiene escaneos de inventario.</Field>
                  ) : (
                    <>
                      <Field label='Último escaneo'>
                        <IconClock size={14} />
                        {formatDateTime(scan.scannedAt)} {daysAgo(scan.scannedAt) && `(${daysAgo(scan.scannedAt)})`}
                      </Field>
                      <Field label='Dónde corre'>
                        {scan.host} · {scan.kind}
                        {scan.model ? ` · ${scan.model}` : ''}
                      </Field>
                      <Field label='Servicio'>
                        {SERVICE_LABELS[scan.serviceStatus ?? ''] ?? scan.serviceStatus ?? '—'}
                      </Field>
                      <Field label='Modo de ejecución'>
                        {execWithoutApproval ? (
                          <TonePill tone='critical' icon={<IconShieldOff size={11} />}>
                            {EXEC_MODE_LABELS['sin-aprobacion']}
                          </TonePill>
                        ) : (
                          <TonePill tone='idle' icon={<IconShieldCheck size={11} />}>
                            {EXEC_MODE_LABELS[scan.execMode ?? ''] ?? scan.execMode ?? 'Desconocido'}
                          </TonePill>
                        )}
                      </Field>
                      <Field label='Reglas de herramientas'>
                        {scan.allowCount} permitidas ·{' '}
                        {scan.denyCount > 0 ? (
                          <Tooltip label={scan.deny.join(', ')} multiline w={280} withArrow zIndex={450}>
                            <span style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{scan.denyCount} negadas</span>
                          </Tooltip>
                        ) : (
                          '0 negadas'
                        )}
                      </Field>
                      <Field label='Skills'>{scan.skillsCount}</Field>
                    </>
                  )}
                  <Field label='Empresas del agente en SynerLink'>
                    {data.companies.length === 0
                      ? '—'
                      : data.companies.map((c) => (
                          <span key={c.id} className={`${s.chip} ${c.isPrimary ? `${s.chipTone} ${toneClass('info')}` : ''}`}>
                            {c.name}
                            {c.isPrimary ? ' (principal)' : ''}
                          </span>
                        ))}
                  </Field>
                  <Field label='Perfil del puente (Proyectos)'>
                    {data.bridge.length === 0 ? (
                      'Sin configuración'
                    ) : (
                      <span style={{ display: 'grid', gap: 2 }}>
                        {data.bridge.map((b) => (
                          <span key={b.companyId}>
                            <strong>{b.companyName}:</strong> {b.enabled ? 'encendido' : 'apagado'} ·{' '}
                            {b.profiles === null
                              ? 'perfiles por defecto del servidor'
                              : b.profiles.length === 0
                                ? 'sin perfiles'
                                : b.profiles.map((p) => p.label).join(', ')}
                          </span>
                        ))}
                      </span>
                    )}
                  </Field>
                  <Field label='Gobierno'>
                    {!data.governance ? (
                      'Sin registro de gobierno'
                    ) : (
                      <span>
                        Director: {data.governance.directorName ?? '—'}
                        {data.governance.directorEmail ? ` (${data.governance.directorEmail})` : ''} · Plantilla de
                        privilegios: {data.governance.privilegeTemplate ?? '—'}
                        {data.governance.privilegeAppliedOn
                          ? `, aplicada ${formatDateTime(data.governance.privilegeAppliedOn)}`
                          : ''}
                        {data.governance.notes ? ` · ${data.governance.notes}` : ''}
                      </span>
                    )}
                  </Field>
                </InsetGroup>

                {/* Conectores agrupados por clasificación */}
                {scan && scan.connectors.length === 0 && (
                  <InsetGroup label='Conectores (0)'>
                    <div className={ps.empty}>El escaneo no encontró conectores.</div>
                  </InsetGroup>
                )}
                {scan &&
                  CONNECTOR_CLASSES.map((cls) => {
                    const items = scan.connectors.filter((c) => c.classification === cls);
                    if (items.length === 0) return null;
                    const style = CLASS_STYLE[cls];
                    const Icon = style.icon;
                    return (
                      <InsetGroup
                        key={cls}
                        label={`Conectores · ${CONNECTOR_CLASS_LABELS[cls]}`}
                        trailing={
                          <TonePill tone={style.tone} icon={<Icon size={11} />}>
                            {items.length}
                          </TonePill>
                        }
                      >
                        {items.map((c) => (
                          <div key={c.name} className={s.connRow}>
                            <div style={{ minWidth: 0 }}>
                              <div className={s.connName}>{c.name}</div>
                              <div className={s.rowHint}>
                                {[c.transport, c.host, c.company ? `Empresa: ${c.company}` : null].filter(Boolean).join(' · ')}
                              </div>
                              {c.writeTools.length > 0 && (
                                <div className={s.rowHint}>Escribe con: {c.writeTools.join(', ')}</div>
                              )}
                            </div>
                            <AccessPill access={c.access} />
                          </div>
                        ))}
                      </InsetGroup>
                    );
                  })}

                <div>
                  <Button
                    size='xs'
                    variant='subtle'
                    leftSection={<IconRefresh size={12} />}
                    onClick={() => setReloadTick((t) => t + 1)}
                  >
                    Volver a cargar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Collapse>
      </div>
    </InsetGroup>
  );
}

