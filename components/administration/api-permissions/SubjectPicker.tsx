'use client';

/**
 * Selector del «sujeto» de un cliente de API (2026-11-09), dentro del grupo
 * «¿Quién es?» del modal. Según el tipo:
 *   - Proveedor o cliente → proveedor o cliente de SAP (NIT), vía API SAP
 *     (búsqueda remota; el servidor de Kronos llama al portal, nunca el navegador).
 *   - Usuario SynerLink   → usuario activo (búsqueda por nombre o correo).
 *   - Otro                → sistema de la lista que administra el equipo, con una hoja
 *     para crear, renombrar y desactivar sistemas.
 *   - México              → persona (nombre y correo), con la hoja «Agregar persona».
 * Agente de IA no usa sujeto (este componente no muestra nada).
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Button, Loader, Modal, TextInput, Textarea } from '@mantine/core';
import { useDebouncedValue, useMediaQuery, useReducedMotion } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconApps,
  IconBuildingStore,
  IconCheck,
  IconChevronRight,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconUser,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { ToneChip, avatarColor, initialsOf, panelStyles as ps, toneClass, type StatusTone } from '@/components/ui/panel/Panel';
import {
  API_CLIENT_LIMITS,
  PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE,
  subjectKindOf,
  type ApiClientType,
} from '@/lib/api-permissions/constants';
import { isPersonEmail } from '@/lib/api-permissions/subject-rules';
import { InsetGroup, SwitchRow, TonePill } from './InsetList';
import s from './apiPermissions.module.css';
import type { ExternalSystemItem, PortalTerceroItem, SynerlinkUserItem } from './types';

export interface SubjectValue {
  ref: string;
  label: string;
}

interface Props {
  type: ApiClientType;
  value: SubjectValue | null;
  onChange: (value: SubjectValue) => void;
  /** Sujeto (ref) → nombre del OTRO cliente del mismo tipo que ya lo usa. */
  usedBy: Map<string, string>;
  isDark: boolean;
}

const BASE = '/api/administration/api-clients';
const SEARCH_ERROR = 'No se pudo buscar. Intenta de nuevo.';

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export default function SubjectPicker(props: Props) {
  const kind = subjectKindOf(props.type);
  if (kind === 'tercero') return <TerceroPicker {...props} />;
  if (kind === 'usuario') return <UserPicker {...props} />;
  if (kind === 'sistema') return <SystemPicker {...props} />;
  if (kind === 'persona') return <PersonPicker {...props} />;
  return null;
}

/* ─────────────────────────────── Búsqueda remota ─────────────────────────────── */

type SearchState<T> =
  | { status: 'loading' }
  | { status: 'short' }
  | { status: 'ok'; items: T[] }
  | { status: 'not_configured'; message: string }
  | { status: 'error'; message: string };

/** Busca con 300 ms de espera tras escribir; cancela la consulta anterior. */
function useRemoteSearch<T>(endpoint: string, query: string, enabled: boolean): [SearchState<T>, () => void] {
  const [debounced] = useDebouncedValue(query.trim().replace(/\s+/g, ' '), 300);
  const [state, setState] = useState<SearchState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (debounced.length === 1) {
      setState({ status: 'short' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const url = debounced ? `${endpoint}?q=${encodeURIComponent(debounced.slice(0, 60))}` : endpoint;
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { items?: T[]; error?: string; code?: string } | null;
        if (controller.signal.aborted) return;
        if (res.status === 503 && body?.code === 'not_configured') {
          setState({ status: 'not_configured', message: body.error || PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE });
        } else if (!res.ok || !body || !Array.isArray(body.items)) {
          setState({ status: 'error', message: body?.error || SEARCH_ERROR });
        } else {
          setState({ status: 'ok', items: body.items });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', message: SEARCH_ERROR });
      });
    return () => controller.abort();
  }, [endpoint, debounced, enabled, attempt]);

  return [state, () => setAttempt((n) => n + 1)];
}

/** Fila de estado (cargando, vacío, error, falta configurar): ícono + texto, anunciada. */
function StateRow({ tone, icon, children, action }: { tone?: StatusTone; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${s.pickState} ${tone ? toneClass(tone) : ''}`} role='status' aria-live='polite'>
      <span className={s.pickStateIcon} aria-hidden>
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
      {action}
    </div>
  );
}

function SearchStates<T>({
  state,
  onRetry,
  emptyText,
  render,
}: {
  state: SearchState<T>;
  onRetry: () => void;
  emptyText: string;
  render: (items: T[]) => ReactNode;
}) {
  if (state.status === 'loading') {
    return (
      <StateRow icon={<Loader size={14} color='currentColor' />}>Buscando…</StateRow>
    );
  }
  if (state.status === 'short') {
    return (
      <StateRow icon={<IconSearch size={14} />}>Escribe al menos 2 caracteres.</StateRow>
    );
  }
  if (state.status === 'not_configured') {
    return (
      <StateRow tone='warning' icon={<IconAlertTriangle size={14} />}>
        {state.message}
      </StateRow>
    );
  }
  if (state.status === 'error') {
    return (
      <StateRow
        tone='critical'
        icon={<IconAlertCircle size={14} />}
        action={
          <button type='button' className={s.linkAction} onClick={onRetry}>
            <IconRefresh size={12} /> Reintentar
          </button>
        }
      >
        {state.message}
      </StateRow>
    );
  }
  if (state.items.length === 0) {
    return <StateRow icon={<IconSearch size={14} />}>{emptyText}</StateRow>;
  }
  return <>{render(state.items)}</>;
}

/** Lo elegido: ícono/avatar, nombre, detalle y «Cambiar». */
function ChosenRow({
  icon,
  title,
  sub,
  warning,
  onChange,
  changeLabel,
}: {
  icon: ReactNode;
  title: string;
  sub: ReactNode;
  warning?: string | null;
  onChange: () => void;
  changeLabel: string;
}) {
  return (
    <div className={s.pickChosen}>
      {icon}
      <div style={{ minWidth: 0 }}>
        <div className={s.pickTitle}>{title}</div>
        <div className={s.pickSub}>{sub}</div>
        {warning && (
          <div style={{ marginTop: 4 }}>
            <TonePill tone='warning' icon={<IconAlertTriangle size={11} />}>
              {warning}
            </TonePill>
          </div>
        )}
      </div>
      <button type='button' className={`${s.linkAction} ${s.press}`} onClick={onChange} aria-label={changeLabel}>
        Cambiar
      </button>
    </div>
  );
}

function SearchBox({
  id,
  label,
  placeholder,
  value,
  onChange,
  onCancel,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCancel?: () => void;
}) {
  return (
    <div className={s.pickSearch}>
      <TextInput
        id={id}
        variant='filled'
        radius='xl'
        size='sm'
        placeholder={placeholder}
        aria-label={label}
        leftSection={<IconSearch size={14} />}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        maxLength={60}
        style={{ flex: 1, minWidth: 0 }}
      />
      {onCancel && (
        <button type='button' className={s.linkAction} onClick={onCancel}>
          Cancelar
        </button>
      )}
    </div>
  );
}

function usedWarning(usedBy: Map<string, string>, ref: string): string | null {
  const other = usedBy.get(ref);
  return other ? `Ya tiene cliente: ${other}` : null;
}

/* ─────────────────────── Proveedor o cliente (API SAP) ─────────────────────── */

function TerceroPicker({ value, onChange, usedBy }: Props) {
  const id = useId();
  const [searching, setSearching] = useState(!value);
  const [query, setQuery] = useState('');
  const [state, retry] = useRemoteSearch<PortalTerceroItem>(`${BASE}/subjects/portal-terceros`, query, searching);

  const pick = (item: PortalTerceroItem) => {
    onChange({ ref: item.nit, label: item.nombre ?? item.nit });
    setSearching(false);
    setQuery('');
  };

  return (
    <div className={s.rowStack}>
      <label className={s.rowLabel} htmlFor={id}>
        Proveedor o cliente
      </label>
      {!searching && value ? (
        <ChosenRow
          icon={
            <span className={s.pickIcon} aria-hidden>
              <IconBuildingStore size={16} />
            </span>
          }
          title={value.label}
          sub={`NIT ${value.ref}`}
          warning={usedWarning(usedBy, value.ref)}
          onChange={() => setSearching(true)}
          changeLabel='Cambiar el proveedor o cliente'
        />
      ) : (
        <>
          <SearchBox
            id={id}
            label='Buscar proveedor o cliente en SAP por nombre o NIT'
            placeholder='Buscar en SAP por nombre o NIT'
            value={query}
            onChange={setQuery}
            onCancel={value ? () => setSearching(false) : undefined}
          />
          <div className={s.pickList} role='radiogroup' aria-label='Proveedores y clientes de SAP'>
            <SearchStates
              state={state}
              onRetry={retry}
              emptyText={
                query.trim()
                  ? 'Ningún proveedor o cliente de SAP coincide.'
                  : 'Escribe el nombre (mínimo 3 letras) o el NIT para buscar en SAP.'
              }
              render={(items) =>
                items.map((item) => {
                  const checked = value?.ref === item.nit;
                  const warning = usedWarning(usedBy, item.nit);
                  return (
                    <button
                      key={item.nit}
                      type='button'
                      role='radio'
                      aria-checked={checked}
                      className={s.pickRow}
                      onClick={() => pick(item)}
                    >
                      <span className={s.pickIcon} aria-hidden>
                        <IconBuildingStore size={16} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className={s.pickTitle}>{item.nombre ?? 'Sin nombre en SAP'}</span>
                        <span className={s.pickSub}>
                          NIT {item.nit}
                          {item.tipo ? ` · ${item.tipo}` : ''}
                        </span>
                        {(item.empresas.length > 0 || warning) && (
                          <span className={s.rowSubWrap} style={{ marginTop: 4 }}>
                            {item.empresas.map((e) => (
                              <span key={e.clave} className={s.chip} title={e.clave}>
                                {e.nombre}
                              </span>
                            ))}
                            {warning && (
                              <TonePill tone='warning' icon={<IconAlertTriangle size={11} />}>
                                {warning}
                              </TonePill>
                            )}
                          </span>
                        )}
                      </span>
                      <span className={s.checkMark} aria-hidden>
                        <IconCheck size={14} stroke={3} />
                      </span>
                    </button>
                  );
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────── Usuario de SynerLink ─────────────────────────────── */

function UserAvatar({ id, name, isDark }: { id: string; name: string; isDark: boolean }) {
  return (
    <span
      className={ps.avatar}
      style={{ width: 32, height: 32, fontSize: 12, background: avatarColor(id, isDark), flex: '0 0 auto' }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

function UserPicker({ value, onChange, usedBy, isDark }: Props) {
  const id = useId();
  const [searching, setSearching] = useState(!value);
  const [query, setQuery] = useState('');
  const [state, retry] = useRemoteSearch<SynerlinkUserItem>(`${BASE}/subjects/synerlink-users`, query, searching);

  const pick = (user: SynerlinkUserItem) => {
    onChange({ ref: user.id, label: user.name || user.email });
    setSearching(false);
    setQuery('');
  };

  return (
    <div className={s.rowStack}>
      <label className={s.rowLabel} htmlFor={id}>
        Usuario de SynerLink
      </label>
      {!searching && value ? (
        <ChosenRow
          icon={<UserAvatar id={value.ref} name={value.label} isDark={isDark} />}
          title={value.label}
          sub='Usuario de SynerLink'
          warning={usedWarning(usedBy, value.ref)}
          onChange={() => setSearching(true)}
          changeLabel='Cambiar el usuario'
        />
      ) : (
        <>
          <SearchBox
            id={id}
            label='Buscar usuario por nombre o correo'
            placeholder='Buscar por nombre o correo'
            value={query}
            onChange={setQuery}
            onCancel={value ? () => setSearching(false) : undefined}
          />
          <div className={s.pickList} role='radiogroup' aria-label='Usuarios activos de SynerLink'>
            <SearchStates
              state={state}
              onRetry={retry}
              emptyText='Ningún usuario activo coincide.'
              render={(items) =>
                items.map((user) => {
                  const name = user.name || user.email;
                  const warning = usedWarning(usedBy, user.id);
                  return (
                    <button
                      key={user.id}
                      type='button'
                      role='radio'
                      aria-checked={value?.ref === user.id}
                      className={s.pickRow}
                      onClick={() => pick(user)}
                    >
                      <UserAvatar id={user.id} name={name} isDark={isDark} />
                      <span style={{ minWidth: 0 }}>
                        <span className={s.pickTitle}>{name}</span>
                        <span className={s.pickSub}>{user.email}</span>
                        {warning && (
                          <span className={s.rowSubWrap} style={{ marginTop: 4 }}>
                            <TonePill tone='warning' icon={<IconAlertTriangle size={11} />}>
                              {warning}
                            </TonePill>
                          </span>
                        )}
                      </span>
                      <span className={s.checkMark} aria-hidden>
                        <IconCheck size={14} stroke={3} />
                      </span>
                    </button>
                  );
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────── Sistema (lista administrable) ─────────────────────────────── */

function SystemPicker({ value, onChange, usedBy }: Props) {
  const labelId = useId();
  const [systems, setSystems] = useState<ExternalSystemItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);

  const load = useCallback(async (): Promise<ExternalSystemItem[] | null> => {
    setError(null);
    try {
      const res = await fetch(`${BASE}/external-systems`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, 'No se pudo cargar la lista de sistemas'));
      const body = (await res.json()) as { items: ExternalSystemItem[] };
      setSystems(body.items);
      return body.items;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la lista de sistemas');
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Tras crear/renombrar/desactivar: recarga y, si renombraron el elegido, actualiza su nombre. */
  const reload = async () => {
    const list = await load();
    if (!list || !value) return;
    const current = list.find((x) => String(x.id) === value.ref);
    if (current && current.name !== value.label) onChange({ ref: value.ref, label: current.name });
  };

  const active = (systems ?? []).filter((x) => x.active);
  const chosen = value ? (systems ?? []).find((x) => String(x.id) === value.ref) ?? null : null;
  const chosenUnavailable = Boolean(value && systems && (!chosen || !chosen.active));

  return (
    <div className={s.rowStack}>
      <span className={s.rowLabel} id={labelId}>
        Sistema
      </span>
      <div className={s.pickList} role='radiogroup' aria-labelledby={labelId}>
        {error ? (
          <StateRow
            tone='critical'
            icon={<IconAlertCircle size={14} />}
            action={
              <button type='button' className={s.linkAction} onClick={() => void load()}>
                <IconRefresh size={12} /> Reintentar
              </button>
            }
          >
            {error}
          </StateRow>
        ) : !systems ? (
          <StateRow icon={<Loader size={14} color='currentColor' />}>Cargando sistemas…</StateRow>
        ) : active.length === 0 ? (
          <StateRow icon={<IconApps size={14} />}>No hay sistemas activos. Agrega uno en «Administrar sistemas».</StateRow>
        ) : (
          active.map((system) => {
            const ref = String(system.id);
            const warning = usedWarning(usedBy, ref);
            return (
              <button
                key={system.id}
                type='button'
                role='radio'
                aria-checked={value?.ref === ref}
                className={s.pickRow}
                onClick={() => onChange({ ref, label: system.name })}
              >
                <span className={s.pickIcon} aria-hidden>
                  <IconApps size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={s.pickTitle}>{system.name}</span>
                  {system.description && <span className={s.pickSub}>{system.description}</span>}
                  {warning && (
                    <span className={s.rowSubWrap} style={{ marginTop: 4 }}>
                      <TonePill tone='warning' icon={<IconAlertTriangle size={11} />}>
                        {warning}
                      </TonePill>
                    </span>
                  )}
                </span>
                <span className={s.checkMark} aria-hidden>
                  <IconCheck size={14} stroke={3} />
                </span>
              </button>
            );
          })
        )}
      </div>
      {chosenUnavailable && value && (
        <span className={s.rowError} role='alert'>
          <IconAlertTriangle size={14} />
          «{value.label}» ya no está activo: elige otro sistema.
        </span>
      )}
      <button type='button' className={`${s.actionRow} ${s.pickManage}`} onClick={() => setManage(true)} disabled={!systems}>
        <IconSettings size={18} />
        Administrar sistemas
        <IconChevronRight size={16} className={ps.chevron} aria-hidden style={{ marginLeft: 'auto' }} />
      </button>
      <ExternalSystemsSheet opened={manage} systems={systems ?? []} onClose={() => setManage(false)} onChanged={reload} />
    </div>
  );
}

interface Draft {
  name: string;
  description: string;
  active: boolean;
}

/** Hoja para crear, renombrar y activar/desactivar sistemas. */
function ExternalSystemsSheet({
  opened,
  systems,
  onClose,
  onChanged,
}: {
  opened: boolean;
  systems: ExternalSystemItem[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const isMobile = useMediaQuery('(max-width: 768px)', false);
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', description: '', active: true });
  const [busy, setBusy] = useState(false);

  const startEdit = (system: ExternalSystemItem) => {
    setEditing(system.id);
    setDraft({ name: system.name, description: system.description ?? '', active: system.active });
  };
  const startNew = () => {
    setEditing('new');
    setDraft({ name: '', description: '', active: true });
  };

  const close = () => {
    if (busy) return;
    setEditing(null);
    onClose();
  };

  const save = async () => {
    if (editing === null || busy) return;
    setBusy(true);
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? `${BASE}/external-systems` : `${BASE}/external-systems/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, description: draft.description.trim() || null, active: draft.active }),
      });
      if (!res.ok) throw new Error(await readError(res, 'No se pudo guardar el sistema'));
      toast.success(isNew ? 'Sistema agregado' : 'Sistema actualizado');
      setEditing(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el sistema');
    } finally {
      setBusy(false);
    }
  };

  const nameOk = draft.name.trim().replace(/\s+/g, ' ').length >= 2;
  const editingSystem = typeof editing === 'number' ? systems.find((x) => x.id === editing) ?? null : null;

  const editor = (
    <div className={s.systemEditor}>
      <TextInput
        label='Nombre'
        placeholder='Ej.: Power Automate'
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.currentTarget.value }))}
        maxLength={API_CLIENT_LIMITS.systemName}
        error={draft.name !== '' && !nameOk ? 'Mínimo 2 caracteres' : undefined}
        data-autofocus
      />
      <Textarea
        label='Descripción'
        placeholder='Para qué se usa (opcional)'
        value={draft.description}
        onChange={(e) => setDraft((d) => ({ ...d, description: e.currentTarget.value }))}
        maxLength={API_CLIENT_LIMITS.systemDescription}
        autosize
        minRows={2}
        maxRows={4}
      />
      <div className={s.card}>
        <SwitchRow
          label={draft.active ? 'Activo' : 'Inactivo'}
          hint={
            !draft.active && editingSystem && editingSystem.clientCount > 0
              ? `Lo usan ${editingSystem.clientCount} ${editingSystem.clientCount === 1 ? 'cliente' : 'clientes'}: siguen funcionando, pero al editarlos habrá que elegir otro sistema.`
              : 'Solo los sistemas activos se pueden elegir.'
          }
          checked={draft.active}
          onChange={(checked) => setDraft((d) => ({ ...d, active: checked }))}
        />
      </div>
      <div className={s.systemEditorActions}>
        <Button variant='default' radius='xl' className={s.press} onClick={() => setEditing(null)} disabled={busy}>
          Cancelar
        </Button>
        <Button radius='xl' className={s.press} onClick={() => void save()} disabled={!nameOk} loading={busy}>
          {editing === 'new' ? 'Agregar' : 'Guardar'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      opened={opened}
      onClose={close}
      withCloseButton={false}
      fullScreen={isMobile}
      size={520}
      centered
      zIndex={300}
      padding={0}
      aria-labelledby={titleId}
      overlayProps={{ backgroundOpacity: 0.35, blur: 4 }}
      transitionProps={{
        transition: isMobile ? 'slide-up' : 'pop',
        duration: reduceMotion ? 0 : 280,
        timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      classNames={{ content: `${ps.root} ${s.root} ${s.sheet} ${isMobile ? '' : s.sheetRounded}`, body: s.sheetBody }}
    >
      <div className={s.sheetHeader}>
        <span />
        <div className={s.sheetTitle}>
          <div className={s.sheetTitleMain} id={titleId}>
            Sistemas
          </div>
          <div className={s.sheetTitleSub}>Para clientes tipo «Otro»</div>
        </div>
        <button type='button' className={`${s.navButton} ${s.navEnd} ${s.press}`} onClick={close} disabled={busy}>
          Listo
        </button>
      </div>
      <div className={s.sheetContent}>
        <InsetGroup
          label='Lista de sistemas'
          trailing={`${systems.filter((x) => x.active).length} activos`}
          footer='Renombrar un sistema actualiza el nombre en los clientes que lo usan.'
        >
          {systems.length === 0 && <div className={ps.empty}>Aún no hay sistemas.</div>}
          {systems.map((system) =>
            editing === system.id ? (
              <div key={system.id} className={s.systemEditing}>
                {editor}
              </div>
            ) : (
              <button
                key={system.id}
                type='button'
                className={s.pickRow}
                onClick={() => startEdit(system)}
                disabled={busy}
                aria-label={`Editar ${system.name}`}
              >
                <span className={s.pickIcon} aria-hidden>
                  <IconApps size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={s.pickTitle}>{system.name}</span>
                  <span className={s.pickSub}>
                    {system.description ? `${system.description} · ` : ''}
                    {system.clientCount} {system.clientCount === 1 ? 'cliente' : 'clientes'}
                  </span>
                </span>
                {system.active ? <ToneChip tone='ok' label='Activo' /> : <ToneChip tone='idle' label='Inactivo' />}
              </button>
            )
          )}
          {editing === 'new' ? (
            <div className={s.systemEditing}>{editor}</div>
          ) : (
            <button
              type='button'
              className={s.actionRow}
              style={{ borderTop: '1px solid var(--pn-hairline)' }}
              onClick={startNew}
              disabled={busy}
            >
              <IconPlus size={18} />
              Nuevo sistema
            </button>
          )}
        </InsetGroup>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────── Persona de México (2026-11-10) ─────────────────────────────── */

/**
 * México: cada persona es un cliente aparte, con su propia llave. Se agrega en una hoja
 * aparte con su nombre y correo; el correo es su identificador (subject_ref) y el nombre
 * queda como nombre del cliente.
 */
function PersonPicker({ value, onChange, usedBy }: Props) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={s.rowStack}>
      <span className={s.rowLabel} id={labelId}>
        Persona
      </span>
      {value ? (
        <div className={s.pickRow} aria-labelledby={labelId}>
          <span className={s.pickIcon} aria-hidden>
            <IconUser size={16} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className={s.pickTitle}>{value.label}</span>
            <span className={s.pickSub}>{value.ref}</span>
          </span>
          <span />
        </div>
      ) : (
        <StateRow icon={<IconUser size={14} />}>Aún no hay persona: agrégala con su nombre y correo.</StateRow>
      )}
      <button type='button' className={`${s.actionRow} ${s.pickManage}`} onClick={() => setOpen(true)}>
        {value ? <IconPencil size={18} /> : <IconPlus size={18} />}
        {value ? 'Cambiar persona' : 'Agregar persona'}
        <IconChevronRight size={16} className={ps.chevron} aria-hidden style={{ marginLeft: 'auto' }} />
      </button>
      <PersonSheet
        opened={open}
        initial={value}
        usedBy={usedBy}
        onClose={() => setOpen(false)}
        onSave={(person) => {
          onChange(person);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** Hoja «Agregar persona» (México): nombre y correo. */
function PersonSheet({
  opened,
  initial,
  usedBy,
  onClose,
  onSave,
}: {
  opened: boolean;
  initial: SubjectValue | null;
  usedBy: Map<string, string>;
  onClose: () => void;
  onSave: (person: SubjectValue) => void;
}) {
  const isMobile = useMediaQuery('(max-width: 768px)', false);
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!opened) return;
    setName(initial?.label ?? '');
    setEmail(initial?.ref ?? '');
  }, [opened, initial]);

  const cleanName = name.trim().replace(/\s+/g, ' ');
  const cleanEmail = email.trim().toLowerCase();
  const nameOk = cleanName.length >= 3;
  const emailOk = isPersonEmail(cleanEmail);
  // Una persona = una llave: si el correo ya es de otro cliente de México, no se deja repetir.
  const takenBy = emailOk ? usedBy.get(cleanEmail) ?? null : null;
  const canSave = nameOk && emailOk && !takenBy;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      fullScreen={isMobile}
      size={480}
      centered
      zIndex={300}
      padding={0}
      aria-labelledby={titleId}
      overlayProps={{ backgroundOpacity: 0.35, blur: 4 }}
      transitionProps={{
        transition: isMobile ? 'slide-up' : 'pop',
        duration: reduceMotion ? 0 : 280,
        timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      classNames={{ content: `${ps.root} ${s.root} ${s.sheet} ${isMobile ? '' : s.sheetRounded}`, body: s.sheetBody }}
    >
      <div className={s.sheetHeader}>
        <button type='button' className={`${s.navButton} ${s.navStart} ${s.press}`} onClick={onClose}>
          Cancelar
        </button>
        <div className={s.sheetTitle}>
          <div className={s.sheetTitleMain} id={titleId}>
            {initial ? 'Cambiar persona' : 'Agregar persona'}
          </div>
          <div className={s.sheetTitleSub}>México (casa matriz)</div>
        </div>
        <button
          type='button'
          className={`${s.navButton} ${s.navEnd} ${s.press}`}
          onClick={() => onSave({ ref: cleanEmail, label: cleanName.slice(0, API_CLIENT_LIMITS.name) })}
          disabled={!canSave}
        >
          Listo
        </button>
      </div>
      <div className={s.sheetContent}>
        <InsetGroup
          label='Datos de la persona'
          footer='Cada persona tiene su propia llave y sus propios permisos. Si deja de trabajar con la API, se le revoca solo a ella.'
        >
          <div className={s.systemEditor}>
            <TextInput
              label='Nombre completo'
              placeholder='Ej.: Ana López'
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={API_CLIENT_LIMITS.name}
              error={name !== '' && !nameOk ? 'Mínimo 3 caracteres' : undefined}
              data-autofocus
            />
            <TextInput
              label='Correo corporativo'
              placeholder='Ej.: ana.lopez@empresa.com.mx'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              maxLength={API_CLIENT_LIMITS.subjectRef}
              error={
                email !== '' && !emailOk
                  ? 'Escribe un correo válido'
                  : takenBy
                    ? `Ese correo ya tiene cliente: ${takenBy}`
                    : undefined
              }
            />
          </div>
        </InsetGroup>
      </div>
    </Modal>
  );
}
