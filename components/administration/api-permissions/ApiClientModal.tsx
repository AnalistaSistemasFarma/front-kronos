'use client';

/**
 * Formulario de un acceso a la API (modal hoja o pantalla /process/api-sap/[id]).
 * Al crear, el tipo se elige con pastillas compactas (Agente · México · Portal · Otro);
 * el cuerpo se adapta al tipo. La llave nueva se muestra UNA sola vez.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Collapse,
  CopyButton,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Select,
  Switch,
  TextInput,
  Textarea,
  useComputedColorScheme,
} from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconClockX,
  IconCopy,
  IconInfoCircle,
  IconKey,
  IconKeyOff,
  IconLock,
  IconPencil,
  IconPlus,
  IconRobot,
  IconRotate,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { avatarColor, initialsOf, panelStyles as ps, toneClass, type StatusTone } from '@/components/ui/panel/Panel';
import {
  AGENT_CODE_REQUIRED_MESSAGE,
  API_CLIENT_LIMITS,
  API_CLIENT_SELECTABLE_TYPES,
  API_CLIENT_TYPE_HINTS,
  API_CLIENT_TYPE_LABELS,
  API_CLIENT_TYPE_SHORT_LABELS,
  permissionRequiresAgentCode,
  API_CLIENT_SUBJECT_LABELS,
  API_KEY_VALIDITY_YEARS,
  clientTypeUsesApiAccess,
  defaultKeyValidityYears,
  isKeyExpired,
  keyValidityLabel,
  parseKeyValidityYears,
  permissionSystemLabel,
  subjectKindOf,
  DEFAULT_API_ACCESS_MODE,
  PER_COMPANY_PERMISSION_SYSTEMS,
  type ApiAccessMode,
  type ApiClientType,
} from '@/lib/api-permissions/constants';
import type { AuthorizedClient } from '@/lib/api-permissions/inventory-rules';
import AgentInventorySection from './AgentInventorySection';
import CopyPermissionsDialog from './CopyPermissionsDialog';
import { ActionSheet, InsetGroup, SwitchRow, TonePill, TypeIcon } from './InsetList';
import PortalAccessSection from './PortalAccessSection';
import SubjectPicker, { type SubjectValue } from './SubjectPicker';
import s from './apiPermissions.module.css';
import {
  formatDateTime,
  formatRelative,
  type AgentItem,
  type ApiClientItem,
  type ApiPermissionItem,
  type CompanyItem,
} from './types';

interface Props {
  opened: boolean;
  /** null = crear. */
  client: ApiClientItem | null;
  /** Tipo elegido al crear (botón «+ Nuevo» de cada sección). */
  initialType?: ApiClientType;
  permissions: ApiPermissionItem[];
  companies: CompanyItem[];
  /** Agentes de IA de SynerLink, para elegirlos de una lista. */
  agents: AgentItem[];
  /** Todos los clientes: para avisar si un agente ya tiene uno. */
  clients: ApiClientItem[];
  onClose: () => void;
  /** Tras guardar: `created` = era nuevo (el modal sigue abierto para generar la llave). */
  onSaved: (clientId: number, created: boolean, client?: ApiClientItem | null) => void;
  /** Cambiaron las llaves: `client` es el cliente ya actualizado por el servidor (si llegó). */
  onKeysChanged: (client?: ApiClientItem | null) => void;
  /** Se copiaron sus permisos a otros clientes: recargar la lista. */
  onPermissionsCopied?: () => void;
  /** Se eliminó el cliente: cerrar el modal y quitarlo de la lista. */
  onDeleted: (clientId: number) => void;
  /**
   * 'modal' (por defecto) = hoja encima de la lista. 'page' (2026-11-11) = pantalla completa
   * (/process/api-sap/[id]): mismo contenido, con migas, título y botones de página.
   */
  variant?: 'modal' | 'page';
  /** Se guardó algo en el portal de proveedores (refresca el resumen de la lista). */
  onPortalChanged?: () => void;
}

interface FormState {
  name: string;
  clientType: ApiClientType;
  description: string;
  agentCode: string;
  /** Sujeto según el tipo (NIT, id de usuario o id de sistema) y su nombre visible. */
  subjectRef: string;
  subjectLabel: string;
  allCompanies: boolean;
  companyIds: string[];
  permissionCodes: string[];
  /** Permisos por empresa (2026-11-11): código → empresas (ids en texto). Sin entrada = todas sus empresas. */
  permissionCompanies: Record<string, string[]>;
  active: boolean;
  /** Nivel de acceso (2026-11-11): solo lectura o lectura y escritura. */
  accessMode: ApiAccessMode;
}

type Confirm =
  | { kind: 'rotate' }
  | { kind: 'revoke'; keyId: number; prefix: string }
  | { kind: 'discard' }
  | { kind: 'delete' }
  | { kind: 'enableWrite' }
  | null;

const EMPTY_FORM: FormState = {
  name: '',
  clientType: 'agente',
  description: '',
  agentCode: '',
  subjectRef: '',
  subjectLabel: '',
  allCompanies: false,
  companyIds: [],
  permissionCodes: [],
  permissionCompanies: {},
  active: true,
  accessMode: DEFAULT_API_ACCESS_MODE,
};

/** Desde cuántas empresas aparece el buscador de empresas. */
const COMPANY_SEARCH_FROM = 8;

/** Máximo de llaves activas por cliente (MAX_ACTIVE_KEYS_PER_CLIENT en lib/api-permissions/db.ts). */
const MAX_ACTIVE_KEYS = 5;

function formFromClient(client: ApiClientItem | null, type: ApiClientType = 'agente'): FormState {
  if (!client) return { ...EMPTY_FORM, clientType: type };
  return {
    name: client.name,
    clientType: client.clientType,
    description: client.description ?? '',
    agentCode: client.agentCode ?? '',
    subjectRef: client.subjectRef ?? '',
    subjectLabel: client.subjectLabel ?? '',
    allCompanies: client.allCompanies,
    companyIds: client.companyIds.map(String),
    permissionCodes: [...client.permissionCodes],
    permissionCompanies: Object.fromEntries(
      Object.entries(client.permissionCompanies ?? {}).map(([code, ids]) => [code, ids.map(String)])
    ),
    active: client.active,
    accessMode: client.accessMode ?? DEFAULT_API_ACCESS_MODE,
  };
}

/** Huella del formulario para saber si hay cambios sin guardar. */
function snapshot(form: FormState): string {
  return JSON.stringify({
    ...form,
    // El nombre visible del sujeto no cuenta como cambio: lo pone el servidor.
    subjectLabel: undefined,
    name: form.name.trim(),
    description: form.description.trim(),
    agentCode: form.agentCode.trim(),
    companyIds: form.allCompanies ? [] : [...form.companyIds].sort(),
    permissionCodes: [...form.permissionCodes].sort(),
    // Orden estable: que reordenar no cuente como cambio.
    permissionCompanies: Object.entries(form.permissionCompanies)
      .filter(([, ids]) => ids.length > 0)
      .map(([code, ids]) => [code, [...ids].sort()])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  });
}

/** Quita las empresas por permiso que el cliente ya no tiene; si a un permiso no le queda ninguna, se desmarca. */
function pruneRestrictions(form: FormState): FormState {
  if (form.allCompanies) return form;
  const available = new Set(form.companyIds);
  const permissionCompanies: Record<string, string[]> = {};
  const dropped = new Set<string>();
  for (const [code, ids] of Object.entries(form.permissionCompanies)) {
    if (ids.length === 0) continue;
    const kept = ids.filter((id) => available.has(id));
    if (kept.length === 0) dropped.add(code);
    else permissionCompanies[code] = kept;
  }
  return { ...form, permissionCompanies, permissionCodes: form.permissionCodes.filter((c) => !dropped.has(c)) };
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error || fallback;
}

function AgentAvatar({
  code,
  name,
  isDark,
  size = 24,
}: {
  code: string;
  name: string;
  isDark: boolean;
  size?: number;
}) {
  return (
    <span
      className={ps.avatar}
      style={{
        width: size,
        height: size,
        fontSize: size <= 24 ? 10 : 12,
        background: avatarColor(code, isDark),
        flex: '0 0 auto',
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

export default function ApiClientModal({
  opened,
  client,
  initialType = 'agente',
  permissions,
  companies,
  agents,
  clients,
  onClose,
  onSaved,
  onKeysChanged,
  onDeleted,
  onPermissionsCopied,
  onPortalChanged,
  variant = 'modal',
}: Props) {
  const isPage = variant === 'page';
  const isMobile = useMediaQuery('(max-width: 768px)', false);
  const reduceMotion = useReducedMotion();
  const isDark = useComputedColorScheme('light', { getInitialValueInEffect: true }) === 'dark';
  const titleId = useId();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [companyQuery, setCompanyQuery] = useState('');
  const [permissionQuery, setPermissionQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  /** Tras crear, hasta que llegue el cliente recargado: evita crear dos veces. */
  const [justCreated, setJustCreated] = useState(false);
  /** Años de vigencia de la próxima llave (0 = no vence). */
  const [validityYears, setValidityYears] = useState<number>(0);

  const clientId = client?.id ?? null;

  /**
   * Permisos por plataforma (`system`) y luego por group_label, en el orden del
   * catálogo. Hoy casi todo es SynerLink; fase 2 sumará Portal, SAP, etc.
   * Los inactivos (p. ej. Usuarios) se ven deshabilitados, no se otorgan.
   */
  const platforms = useMemo(() => {
    type GroupEntry = [string, ApiPermissionItem[]];
    const bySystem = new Map<string, Map<string, ApiPermissionItem[]>>();
    const systemOrder: string[] = [];
    for (const p of [...permissions].sort((a, b) => a.displayOrder - b.displayOrder)) {
      // Lo que ve un proveedor en el portal viene de la landing (PortalAccessSection), no se marca aquí.
      if (p.system === 'portal_terceros') continue;
      if (!bySystem.has(p.system)) {
        bySystem.set(p.system, new Map());
        systemOrder.push(p.system);
      }
      const groups = bySystem.get(p.system)!;
      const list = groups.get(p.groupLabel) ?? [];
      list.push(p);
      groups.set(p.groupLabel, list);
    }
    return systemOrder.map((system) => ({
      system,
      label: permissionSystemLabel(system),
      groups: [...(bySystem.get(system)?.entries() ?? [])] as GroupEntry[],
    }));
  }, [permissions]);

  /** Aplanado por group_label (busca / acordeones internos). */
  const groups = useMemo(() => platforms.flatMap((p) => p.groups), [platforms]);

  // Al abrir (o cambiar de cliente) se recarga el formulario. La llave en claro
  // solo se borra al cerrar: tras crear, el modal sigue abierto con el cliente nuevo.
  useEffect(() => {
    if (!opened) {
      setNewKey(null);
      setConfirm(null);
      return;
    }
    setJustCreated(false);
    const next = formFromClient(client, initialType);
    setValidityYears(defaultKeyValidityYears(next.clientType));
    setForm(next);
    setCompanyQuery('');
    setPermissionQuery('');
    // Abiertos de entrada: plataformas y grupos con algo marcado.
    const marked = new Set(next.permissionCodes);
    const open: string[] = [];
    for (const platform of platforms) {
      let platformHit = false;
      for (const [label, items] of platform.groups) {
        if (items.some((p) => marked.has(p.code))) {
          open.push(label);
          platformHit = true;
        }
      }
      if (platformHit) open.push(`sys:${platform.system}`);
    }
    setOpenGroups(open);
  }, [opened, clientId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const baseline = useMemo(() => snapshot(formFromClient(client, initialType)), [client, initialType]);
  const dirty = opened && snapshot(form) !== baseline;

  // Pantalla completa: si hay cambios sin guardar, el navegador avisa antes de cerrar o recargar la pestaña.
  useEffect(() => {
    if (!isPage || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isPage, dirty]);

  const selected = useMemo(() => new Set(form.permissionCodes), [form.permissionCodes]);
  const activeCodes = useMemo(() => new Set(permissions.filter((p) => p.active).map((p) => p.code)), [permissions]);
  const grantedCount = form.permissionCodes.filter((code) => activeCodes.has(code)).length;

  /** Se puede marcar: activo en el catálogo y, si escribe, solo con «Permitir escritura». */
  const canGrant = (p: ApiPermissionItem) => p.active && (p.accessKind !== 'escritura' || form.accessMode === 'escritura');

  /** Apagar la escritura quita al instante los permisos que escriben (el servidor tampoco los acepta). */
  const setAccessMode = (mode: ApiAccessMode) =>
    setForm((prev) => {
      if (mode === 'escritura') return { ...prev, accessMode: mode };
      const writeCodes = new Set(permissions.filter((p) => p.accessKind === 'escritura').map((p) => p.code));
      return { ...prev, accessMode: mode, permissionCodes: prev.permissionCodes.filter((c) => !writeCodes.has(c)) };
    });

  const withoutRestriction = (map: Record<string, string[]>, codes: Iterable<string>) => {
    const next = { ...map };
    for (const code of codes) delete next[code];
    return next;
  };

  const togglePermission = (code: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      permissionCodes: checked
        ? [...prev.permissionCodes.filter((c) => c !== code), code]
        : prev.permissionCodes.filter((c) => c !== code),
      permissionCompanies: checked ? prev.permissionCompanies : withoutRestriction(prev.permissionCompanies, [code]),
    }));

  /** Empresas donde vale un permiso (vacío = todas sus empresas). Elegirlas todas = «todas». */
  const setPermissionCompanies = (code: string, ids: string[], availableCount: number) =>
    setForm((prev) => ({
      ...prev,
      permissionCompanies:
        ids.length === 0 || ids.length >= availableCount
          ? withoutRestriction(prev.permissionCompanies, [code])
          : { ...prev.permissionCompanies, [code]: ids },
    }));

  const toggleGroup = (items: ApiPermissionItem[], checked: boolean) =>
    setForm((prev) => {
      const codes = new Set(prev.permissionCodes);
      for (const item of items) {
        if (checked && canGrant(item)) codes.add(item.code);
        else codes.delete(item.code);
      }
      return {
        ...prev,
        permissionCodes: [...codes],
        permissionCompanies: checked
          ? prev.permissionCompanies
          : withoutRestriction(
              prev.permissionCompanies,
              items.map((i) => i.code)
            ),
      };
    });

  const toggleCompany = (id: string) =>
    setForm((prev) =>
      pruneRestrictions({
        ...prev,
        companyIds: prev.companyIds.includes(id) ? prev.companyIds.filter((c) => c !== id) : [...prev.companyIds, id],
      })
    );

  /** Empresas que se pueden elegir en un permiso: las del cliente (o todas si tiene «Todas las empresas»). */
  const restrictionOptions = useMemo(
    () =>
      (form.allCompanies ? companies : companies.filter((c) => form.companyIds.includes(String(c.id)))).map((c) => ({
        value: String(c.id),
        label: c.name,
      })),
    [companies, form.allCompanies, form.companyIds]
  );

  const isAgent = form.clientType === 'agente';
  const permissionsNeedAgent = form.permissionCodes.some(permissionRequiresAgentCode);
  const needsAgentCode = (isAgent || permissionsNeedAgent) && !form.agentCode.trim();
  const showAgent = isAgent || permissionsNeedAgent || form.agentCode.trim() !== '';

  /** Lo autorizado según el formulario, para comparar con el inventario («Lo que tiene hoy»). */
  const authorized = useMemo<AuthorizedClient>(
    () => ({
      saved: clientId !== null,
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds.map(Number),
      permissionCodes: form.permissionCodes.filter((code) => permissions.some((p) => p.active && p.code === code)),
    }),
    [clientId, form.allCompanies, form.companyIds, form.permissionCodes, permissions]
  );

  /** Lista de agentes para elegir: marca los inactivos y los que ya tienen otro cliente. */
  const agentOptions = useMemo(() => {
    const usedBy = new Map(
      clients.filter((c) => c.agentCode && c.id !== clientId).map((c) => [c.agentCode as string, c.name])
    );
    return agents.map((a) => {
      const notes = [
        !a.active ? 'inactivo' : null,
        usedBy.has(a.code) ? `ya tiene cliente: ${usedBy.get(a.code)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { value: a.code, label: notes ? `${a.name} (${notes})` : a.name };
    });
  }, [agents, clients, clientId]);
  const agentByCode = useMemo(() => new Map(agents.map((a) => [a.code, a])), [agents]);
  const chosenAgent = form.agentCode ? (agentByCode.get(form.agentCode) ?? null) : null;

  const chooseAgent = (code: string | null) => {
    const agent = agents.find((a) => a.code === code);
    setForm((prev) => ({
      ...prev,
      agentCode: code ?? '',
      // Si el nombre está vacío, se llena con el del agente.
      name: prev.name.trim() || !agent ? prev.name : agent.name,
      // Quitar el agente (2026-11-11) quita también los permisos que solo funcionan con agente
      // (Proyectos, Correo, «Solicitar conectores de IA»); si no, no se podría guardar.
      permissionCodes: code ? prev.permissionCodes : prev.permissionCodes.filter((c) => !permissionRequiresAgentCode(c)),
    }));
  };

  /** Al crear se puede cambiar el tipo (pastillas); limpia identidad que ya no aplica. */
  const chooseType = (type: ApiClientType) => {
    if (clientId !== null) return;
    setForm((prev) => {
      const keepAgent = type === 'agente';
      const keepSubject = subjectKindOf(type) !== null && subjectKindOf(type) === subjectKindOf(prev.clientType);
      return {
        ...prev,
        clientType: type,
        agentCode: keepAgent ? prev.agentCode : '',
        permissionCodes: keepAgent
          ? prev.permissionCodes
          : prev.permissionCodes.filter((c) => !permissionRequiresAgentCode(c)),
        subjectRef: keepSubject ? prev.subjectRef : '',
        subjectLabel: keepSubject ? prev.subjectLabel : '',
      };
    });
    setValidityYears(defaultKeyValidityYears(type));
  };

  const subjectKind = subjectKindOf(form.clientType);
  const subjectValue: SubjectValue | null = form.subjectRef
    ? { ref: form.subjectRef, label: form.subjectLabel || form.subjectRef }
    : null;

  const typeOptions: readonly ApiClientType[] = API_CLIENT_SELECTABLE_TYPES.includes(form.clientType)
    ? API_CLIENT_SELECTABLE_TYPES
    : [...API_CLIENT_SELECTABLE_TYPES, form.clientType];

  /** Sujetos que ya usa OTRO cliente del mismo tipo (aviso, como con los agentes). */
  const subjectUsedBy = useMemo(
    () =>
      new Map(
        clients
          .filter((c) => c.clientType === form.clientType && c.subjectRef && c.id !== clientId)
          .map((c) => [c.subjectRef as string, c.name])
      ),
    [clients, form.clientType, clientId]
  );

  /** Elegir el sujeto: si el nombre está vacío, se llena con el del sujeto. */
  const chooseSubject = (value: SubjectValue) =>
    setForm((prev) => ({
      ...prev,
      subjectRef: value.ref,
      subjectLabel: value.label,
      // Persona de México: el nombre del cliente ES el de la persona (se cambia desde «Cambiar persona»).
      name: subjectKind === 'persona' || !prev.name.trim() ? value.label.slice(0, API_CLIENT_LIMITS.name) : prev.name,
    }));

  const companyNeedle = normalize(companyQuery);
  const visibleCompanies = useMemo(
    () => (companyNeedle ? companies.filter((c) => normalize(c.name).includes(companyNeedle)) : companies),
    [companies, companyNeedle]
  );
  const selectedCompanies = useMemo(() => new Set(form.companyIds), [form.companyIds]);
  const companyCount = companies.filter((c) => selectedCompanies.has(String(c.id))).length;

  const permissionNeedle = normalize(permissionQuery);
  const visiblePlatforms = useMemo(() => {
    if (!permissionNeedle) return platforms;
    return platforms
      .map((platform) => {
        const platformHit = normalize(platform.label).includes(permissionNeedle);
        const filteredGroups = platform.groups
          .map(([label, items]) => {
            if (platformHit || normalize(label).includes(permissionNeedle)) {
              return [label, items] as [string, ApiPermissionItem[]];
            }
            const matches = items.filter((p) =>
              normalize(`${p.label} ${p.description ?? ''} ${p.code}`).includes(permissionNeedle)
            );
            return [label, matches] as [string, ApiPermissionItem[]];
          })
          .filter(([, items]) => items.length > 0);
        return { ...platform, groups: filteredGroups };
      })
      .filter((platform) => platform.groups.length > 0);
  }, [platforms, permissionNeedle]);

  /** ¿Se conecta por API? (Proveedor o cliente no: solo se administra su portal.) */
  const usesApi = clientTypeUsesApiAccess(form.clientType);
  /** Agente sin elegir: aún no se despliega lo demás. */
  const agentPending = isAgent && !form.agentCode.trim();

  const missing = [
    form.name.trim().length < 3 ? 'nombre' : null,
    usesApi && !form.allCompanies && form.companyIds.length === 0 ? 'empresas' : null,
    needsAgentCode ? 'agente' : null,
    subjectKind && !form.subjectRef ? API_CLIENT_SUBJECT_LABELS[subjectKind].toLowerCase() : null,
  ].filter((x): x is string => x !== null);

  const canSave = missing.length === 0 && !saving && !justCreated && (clientId === null || dirty);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirm({ kind: 'discard' });
    else onClose();
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        clientType: form.clientType,
        description: form.description.trim() || null,
        agentCode: form.agentCode.trim() || null,
        subjectRef: subjectKind ? form.subjectRef || null : null,
        allCompanies: form.allCompanies,
        companyIds: form.allCompanies ? [] : form.companyIds.map(Number),
        // Solo códigos del catálogo activo (uno desactivado después no bloquea el guardado).
        permissionCodes: form.permissionCodes.filter((code) => permissions.some((p) => p.active && p.code === code)),
        active: form.active,
        accessMode: form.accessMode,
        // Solo de permisos que quedan marcados y que se pueden limitar por empresa (SAP).
        permissionCompanies: Object.fromEntries(
          Object.entries(form.permissionCompanies)
            .filter(
              ([code, ids]) =>
                ids.length > 0 &&
                form.permissionCodes.includes(code) &&
                PER_COMPANY_PERMISSION_SYSTEMS.includes(permissions.find((p) => p.code === code)?.system ?? '')
            )
            .map(([code, ids]) => [code, ids.map(Number)])
        ),
      };
      const res = await fetch(
        clientId ? `/api/administration/api-clients/${clientId}` : '/api/administration/api-clients',
        {
          method: clientId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(await readError(res, 'No se pudo guardar el cliente'));
      const body = (await res.json().catch(() => ({}))) as { id?: number; client?: ApiClientItem | null };
      const savedId = clientId ?? body.id;
      toast.success(
        clientId
          ? 'Cliente actualizado'
          : usesApi
            ? 'Cliente creado. Ahora genera su llave.'
            : 'Proveedor o cliente agregado'
      );
      if (!clientId) setJustCreated(true);
      if (savedId) onSaved(savedId, !clientId, body.client);
      if (clientId) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el cliente');
    } finally {
      setSaving(false);
    }
  };

  const generateKey = async (rotate: boolean) => {
    if (!clientId) return;
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/administration/api-clients/${clientId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotate, validityYears }),
      });
      if (!res.ok) throw new Error(await readError(res, 'No se pudo generar la llave'));
      const body = (await res.json()) as { key: string; client?: ApiClientItem | null };
      setNewKey(body.key);
      toast.success(rotate ? 'Llaves rotadas: las anteriores quedaron revocadas' : 'Llave generada');
      onKeysChanged(body.client);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar la llave');
    } finally {
      setKeyBusy(false);
      setConfirm(null);
    }
  };

  const revokeKey = async (keyId: number) => {
    if (!clientId) return;
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/administration/api-clients/${clientId}/keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res, 'No se pudo revocar la llave'));
      const body = (await res.json().catch(() => ({}))) as { client?: ApiClientItem | null };
      toast.success('Llave revocada');
      onKeysChanged(body.client);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo revocar la llave');
    } finally {
      setKeyBusy(false);
      setConfirm(null);
    }
  };

  const deleteClient = async () => {
    if (!clientId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/administration/api-clients/${clientId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res, 'No se pudo eliminar el cliente'));
      toast.success('Cliente eliminado');
      setConfirm(null);
      onDeleted(clientId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el cliente');
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const footerState: { tone: StatusTone; icon: ReactNode; text: string } =
    missing.length > 0
      ? {
          tone: 'warning',
          icon: <IconAlertTriangle size={14} />,
          text: `Falta: ${missing.join(', ')}`,
        }
      : dirty
        ? {
            tone: 'info',
            icon: <IconInfoCircle size={14} />,
            text: clientId ? 'Cambios sin guardar' : 'Listo para crear',
          }
        : {
            tone: 'ok',
            icon: <IconCircleCheck size={14} />,
            text: 'Todo guardado',
          };

  const keys = client?.keys ?? [];

  const sheetInner = (
    <>
        {/* Encabezado de vidrio: Cancelar · título · Guardar/Crear */}
        {isPage ? (
          <header className={s.clientPageHeader}>
            <div style={{ minWidth: 0 }}>
              {/* Retroceso: vuelve a la lista de API SAP (si hay cambios sin guardar, pide confirmación). */}
              <nav aria-label='Ruta' className={s.clientPageCrumbs}>
                <button type='button' className={s.clientPageBack} onClick={requestClose} disabled={saving}>
                  <IconArrowLeft size={16} aria-hidden />
                  API SAP
                </button>
                <IconChevronRight size={14} aria-hidden />
                <span>Clientes de API</span>
              </nav>
              <h1 className={s.clientPageTitle} id={titleId}>
                {clientId ? (client?.name ?? 'Cliente de API') : 'Nuevo cliente de API'}
              </h1>
              <div className={s.clientPageSubtitle}>{API_CLIENT_TYPE_LABELS[form.clientType]}</div>
            </div>
            <Group gap='sm' wrap='nowrap' className={s.clientPageActions}>
              <Button variant='default' onClick={requestClose} disabled={saving} leftSection={<IconArrowLeft size={16} />}>
                {dirty ? 'Cancelar' : 'Volver'}
              </Button>
              <Button onClick={() => void save()} disabled={!canSave} loading={saving}>
                {clientId ? 'Guardar' : 'Crear'}
              </Button>
            </Group>
          </header>
        ) : (
          <div className={s.sheetHeader}>
            <button
              type='button'
              className={`${s.navButton} ${s.navStart} ${s.press}`}
              onClick={requestClose}
              disabled={saving}
            >
              {dirty ? 'Cancelar' : 'Cerrar'}
            </button>
            <div className={s.sheetTitle}>
              <div className={s.sheetTitleMain} id={titleId}>
                {clientId ? (client?.name ?? 'Cliente de API') : 'Nuevo cliente de API'}
              </div>
              <div className={s.sheetTitleSub}>{API_CLIENT_TYPE_LABELS[form.clientType]}</div>
            </div>
            <button
              type='button'
              className={`${s.navButton} ${s.navEnd} ${s.press}`}
              onClick={() => void save()}
              disabled={!canSave}
              aria-busy={saving || undefined}
            >
              {saving && <Loader size={14} color='currentColor' />}
              {clientId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        )}

        <div className={s.sheetContent}>
          {/* ───────────── 1. Quién ───────────── */}
          {
            <InsetGroup label='Quién' footer={API_CLIENT_TYPE_HINTS[form.clientType]}>
              <div className={s.rowStack} style={{ borderTop: 0 }}>
                <span className={s.rowLabel} id={`${titleId}-type`}>
                  Tipo
                </span>
                {clientId === null ? (
                  <div className={s.typePills} role='radiogroup' aria-labelledby={`${titleId}-type`}>
                    {typeOptions.map((type) => {
                      const active = form.clientType === type;
                      return (
                        <button
                          key={type}
                          type='button'
                          role='radio'
                          aria-checked={active}
                          className={`${s.typePill} ${s.press} ${active ? s.typePillActive : ''}`}
                          onClick={() => chooseType(type)}
                          data-autofocus={type === form.clientType ? true : undefined}
                        >
                          <TypeIcon type={type} isDark={isDark} size={16} />
                          {API_CLIENT_TYPE_SHORT_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={s.lockedTypeRow}>
                    <TypeIcon type={form.clientType} isDark={isDark} size={22} />
                    <span className={s.lockedTypeLabel}>{API_CLIENT_TYPE_LABELS[form.clientType]}</span>
                  </div>
                )}
              </div>

              {subjectKind && (
                <SubjectPicker
                  key={`${clientId ?? 'nuevo'}-${subjectKind}`}
                  type={form.clientType}
                  value={subjectValue}
                  onChange={chooseSubject}
                  usedBy={subjectUsedBy}
                  isDark={isDark}
                />
              )}

              {showAgent && (
                <div className={s.rowStack}>
                  <label className={s.rowLabel} htmlFor={`${titleId}-agent`}>
                    Agente{isAgent || permissionsNeedAgent ? '' : ' (opcional)'}
                  </label>
                  <Select
                    id={`${titleId}-agent`}
                    placeholder={agents.length ? 'Buscar agente…' : 'No hay agentes registrados'}
                    data={agentOptions}
                    value={form.agentCode || null}
                    onChange={chooseAgent}
                    searchable
                    clearable={!isAgent}
                    nothingFoundMessage='Ningún agente coincide'
                    comboboxProps={{ withinPortal: true, zIndex: 350 }}
                    variant='filled'
                    leftSection={
                      chosenAgent ? (
                        <AgentAvatar code={chosenAgent.code} name={chosenAgent.name} isDark={isDark} size={22} />
                      ) : (
                        <IconRobot size={16} />
                      )
                    }
                    renderOption={({ option, checked }) => {
                      const agent = agentByCode.get(option.value);
                      return (
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          <AgentAvatar code={option.value} name={agent?.name ?? option.label} isDark={isDark} />
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {option.label}
                          </span>
                          {checked && <IconCheck size={14} />}
                        </span>
                      );
                    }}
                    error={needsAgentCode ? (isAgent ? 'Elige el agente' : AGENT_CODE_REQUIRED_MESSAGE) : undefined}
                  />
                  {!isAgent && permissionsNeedAgent && (
                    <span className={s.rowHint}>
                      Algunos permisos marcados actúan en nombre de un agente. Si quitas el agente (✕), esos permisos se
                      desmarcan.
                    </span>
                  )}
                </div>
              )}

              {/* Proveedor o cliente: el nombre lo pone el proveedor elegido (se muestra solo si falta). */}
              {/* México: el nombre es el de la persona (hoja «Agregar persona»). */}
              {((usesApi && subjectKind !== 'persona') || form.name.trim().length < 3) && (
                <div className={s.row}>
                  <label className={s.rowLabel} htmlFor={`${titleId}-name`}>
                    Nombre
                  </label>
                  <TextInput
                    id={`${titleId}-name`}
                    variant='unstyled'
                    placeholder={
                      isAgent
                        ? 'Ej.: Zoe, Galileo'
                        : form.clientType === 'portal_terceros'
                          ? 'Ej.: Proveedor ACME'
                          : form.clientType === 'synerlink'
                            ? 'Ej.: Integración de compras'
                            : form.clientType === 'otro'
                              ? 'Ej.: n8n facturación'
                              : 'Ej.: Integración México'
                    }
                    value={form.name}
                    onChange={(e) => set('name', e.currentTarget.value)}
                    maxLength={API_CLIENT_LIMITS.name}
                    aria-required
                  />
                </div>
              )}

              {usesApi && (
                <SwitchRow
                  label={form.active ? 'Activo' : 'Inactivo'}
                  checked={form.active}
                  onChange={(checked) => set('active', checked)}
                />
              )}

              {usesApi && (
                <div className={s.rowStack}>
                  <label className={s.rowLabel} htmlFor={`${titleId}-desc`}>
                    Descripción
                  </label>
                  <Textarea
                    id={`${titleId}-desc`}
                    variant='unstyled'
                    placeholder='Para qué se usa y quién es el responsable'
                    value={form.description}
                    onChange={(e) => set('description', e.currentTarget.value)}
                    maxLength={API_CLIENT_LIMITS.description}
                    autosize
                    minRows={2}
                    maxRows={5}
                  />
                </div>
              )}
            </InsetGroup>
          }

          {/* ───────────── Nivel de acceso (2026-11-11): todos los tipos ───────────── */}
          {!(usesApi && agentPending) && (
            <InsetGroup
              label='Nivel de acceso'
              footer={
                form.accessMode === 'escritura'
                  ? 'Lectura y escritura: puede consultar y también usar los permisos marcados como «Escritura» (crear, editar, subir…).'
                  : 'Solo lectura: puede consultar lo que le marques, pero ningún permiso de escritura.'
              }
            >
              <SwitchRow
                label='Permitir escritura'
                checked={form.accessMode === 'escritura'}
                onChange={(checked) => {
                  // Encender da permiso de cambiar datos: se confirma. Apagar es directo y quita los de escritura.
                  if (checked) setConfirm({ kind: 'enableWrite' });
                  else setAccessMode('lectura');
                }}
              />
            </InsetGroup>
          )}

          {/* ───────────── Proveedor o cliente: solo lo que ve en el portal (API de la landing) ───────────── */}
          {!usesApi && (
            <PortalAccessSection
              nit={form.subjectRef || null}
              nombre={form.subjectLabel || null}
              onChanged={onPortalChanged}
            />
          )}

          {/* ───────────── Agente sin elegir: lo demás se despliega al elegirlo ───────────── */}
          {usesApi && agentPending && (
            <div className={`${s.card} ${ps.empty}`}>
              Elige el agente arriba: se desplegará lo que tiene hoy y podrás gestionar sus permisos.
            </div>
          )}

          {usesApi && !agentPending && (
            <>
              {/* ───────────── Lo que tiene hoy (agente elegido) ───────────── */}
              {form.agentCode.trim() && (
                <AgentInventorySection
                  agentCode={form.agentCode.trim()}
                  authorized={authorized}
                  companies={companies}
                />
              )}

              {/* ───────────── 2. Para estas empresas ───────────── */}
              <InsetGroup
                label='Para estas empresas'
                trailing={
                  form.allCompanies ? (
                    'Todas'
                  ) : (
                    <>
                      {`${companyCount} ${companyCount === 1 ? 'seleccionada' : 'seleccionadas'}`}
                      {companyCount > 0 && (
                        <button type='button' className={s.linkAction} onClick={() => set('companyIds', [])}>
                          Quitar todas
                        </button>
                      )}
                    </>
                  )
                }
                footer={
                  !form.allCompanies && form.companyIds.length === 0
                    ? 'Elige al menos una empresa o activa «Todas las empresas».'
                    : form.allCompanies
                      ? 'Úsalo solo si el cliente de verdad necesita ver todas las empresas.'
                      : 'En las empresas que marques, el cliente podrá usar los permisos de abajo.'
                }
                footerTone={!form.allCompanies && form.companyIds.length === 0 ? 'warning' : undefined}
                footerIcon={<IconAlertTriangle size={14} />}
              >
                <SwitchRow
                  label='Todas las empresas'
                  checked={form.allCompanies}
                  onChange={(checked) => setForm((prev) => pruneRestrictions({ ...prev, allCompanies: checked }))}
                />
                {!form.allCompanies && (
                  <>
                    {companies.length > COMPANY_SEARCH_FROM && (
                      <div className={s.inputRow} style={{ borderTop: '1px solid var(--pn-hairline)' }}>
                        <TextInput
                          variant='filled'
                          radius='xl'
                          size='sm'
                          placeholder='Buscar empresa'
                          aria-label='Buscar empresa'
                          leftSection={<IconSearch size={14} />}
                          value={companyQuery}
                          onChange={(e) => setCompanyQuery(e.currentTarget.value)}
                        />
                      </div>
                    )}
                    <div
                      className={companies.length > COMPANY_SEARCH_FROM ? s.scrollList : undefined}
                      role='group'
                      aria-label='Empresas permitidas (selección múltiple)'
                      style={
                        companies.length > COMPANY_SEARCH_FROM
                          ? undefined
                          : { borderTop: '1px solid var(--pn-hairline)' }
                      }
                    >
                      {visibleCompanies.length === 0 ? (
                        <div className={ps.empty}>Ninguna empresa coincide.</div>
                      ) : (
                        visibleCompanies.map((company) => {
                          const id = String(company.id);
                          const checked = selectedCompanies.has(id);
                          return (
                            <button
                              key={company.id}
                              type='button'
                              role='checkbox'
                              aria-checked={checked}
                              className={s.check}
                              onClick={() => toggleCompany(id)}
                            >
                              <span className={s.checkName}>{company.name}</span>
                              <span className={s.checkMark} aria-hidden>
                                <IconCheck size={14} stroke={3} />
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </InsetGroup>

              <InsetGroup
                label='Tienen permiso en'
                trailing={`${grantedCount} ${grantedCount === 1 ? 'marcado' : 'marcados'}`}
                footer='Marca en qué plataformas puede actuar. El servidor MCP toma los cambios en máximo 1 minuto.'
                bare
              >
                <div className={s.stackSm}>
                  <TextInput
                    radius='xl'
                    placeholder='Buscar permiso'
                    aria-label='Buscar permiso'
                    leftSection={<IconSearch size={16} />}
                    value={permissionQuery}
                    onChange={(e) => setPermissionQuery(e.currentTarget.value)}
                  />
                  {visiblePlatforms.length === 0 && (
                    <div className={`${s.card} ${ps.empty}`}>Ningún permiso coincide.</div>
                  )}
                  {visiblePlatforms.map((platform) => {
                    const allItems = platform.groups.flatMap(([, items]) => items);
                    const grantable = allItems.filter(canGrant);
                    const marked = grantable.filter((p) => selected.has(p.code)).length;
                    const platformOpenKey = `sys:${platform.system}`;
                    const platformOpen = permissionNeedle !== '' || openGroups.includes(platformOpenKey) || marked > 0;
                    const platformBodyId = `${titleId}-sys-${platform.system}`;
                    return (
                      <div key={platform.system} className={s.platformCard}>
                        <div className={s.accHeader}>
                          <button
                            type='button'
                            className={s.disclosure}
                            aria-expanded={platformOpen}
                            aria-controls={platformBodyId}
                            onClick={() =>
                              setOpenGroups((prev) =>
                                prev.includes(platformOpenKey)
                                  ? prev.filter((g) => g !== platformOpenKey)
                                  : [...prev, platformOpenKey]
                              )
                            }
                            disabled={permissionNeedle !== ''}
                          >
                            <IconChevronRight
                              size={16}
                              className={`${s.chevronRotate} ${platformOpen ? s.chevronOpen : ''}`}
                              aria-hidden
                            />
                            <span className={s.accTitle}>{platform.label}</span>
                            <span className={`${s.counter} ${marked > 0 ? s.counterOn : ''}`}>
                              {grantable.length === 0 ? 'No disponible' : `${marked} de ${grantable.length}`}
                            </span>
                          </button>
                          <Switch
                            size='sm'
                            label='Toda la plataforma'
                            labelPosition='left'
                            aria-label={`Toda la plataforma ${platform.label}`}
                            checked={grantable.length > 0 && marked === grantable.length}
                            disabled={grantable.length === 0}
                            onChange={(e) => toggleGroup(allItems, e.currentTarget.checked)}
                            classNames={{ label: s.groupSwitchText }}
                            styles={{
                              label: {
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--pn-muted)',
                              },
                            }}
                          />
                        </div>
                        <Collapse
                          in={platformOpen}
                          id={platformBodyId}
                          transitionDuration={reduceMotion ? 0 : 280}
                          transitionTimingFunction='cubic-bezier(0.22, 1, 0.36, 1)'
                        >
                          <div className={s.platformBody}>
                            {platform.groups.map(([groupLabel, items]) => {
                              if (items.length === 0) return null;
                              const all = groups.find(([label]) => label === groupLabel)?.[1] ?? items;
                              const groupGrantable = all.filter(canGrant);
                              const groupMarked = groupGrantable.filter((p) => selected.has(p.code)).length;
                              const open = permissionNeedle !== '' || openGroups.includes(groupLabel);
                              const bodyId = `${titleId}-g-${groupLabel.replace(/\W+/g, '-')}`;
                              return (
                                <div key={groupLabel} className={s.card}>
                                  <div className={s.accHeader}>
                                    <button
                                      type='button'
                                      className={s.disclosure}
                                      aria-expanded={open}
                                      aria-controls={bodyId}
                                      onClick={() =>
                                        setOpenGroups((prev) =>
                                          prev.includes(groupLabel)
                                            ? prev.filter((g) => g !== groupLabel)
                                            : [...prev, groupLabel]
                                        )
                                      }
                                      disabled={permissionNeedle !== ''}
                                    >
                                      <IconChevronRight
                                        size={16}
                                        className={`${s.chevronRotate} ${open ? s.chevronOpen : ''}`}
                                        aria-hidden
                                      />
                                      <span className={s.accTitle}>{groupLabel}</span>
                                      <span className={`${s.counter} ${groupMarked > 0 ? s.counterOn : ''}`}>
                                        {groupGrantable.length === 0
                                          ? 'No disponible'
                                          : `${groupMarked} de ${groupGrantable.length}`}
                                      </span>
                                    </button>
                                    <Switch
                                      size='sm'
                                      label='Todo el grupo'
                                      labelPosition='left'
                                      aria-label={`Todo el grupo ${groupLabel}`}
                                      checked={groupGrantable.length > 0 && groupMarked === groupGrantable.length}
                                      disabled={groupGrantable.length === 0}
                                      onChange={(e) => toggleGroup(all, e.currentTarget.checked)}
                                      classNames={{ label: s.groupSwitchText }}
                                      styles={{
                                        label: {
                                          fontSize: 12,
                                          fontWeight: 600,
                                          color: 'var(--pn-muted)',
                                        },
                                      }}
                                    />
                                  </div>
                                  <Collapse
                                    in={open}
                                    id={bodyId}
                                    transitionDuration={reduceMotion ? 0 : 280}
                                    transitionTimingFunction='cubic-bezier(0.22, 1, 0.36, 1)'
                                  >
                                    <div className={s.accBody}>
                                      {items.map((p) => (
                                        <SwitchRow
                                          key={p.code}
                                          className={canGrant(p) ? undefined : s.permOff}
                                          checked={canGrant(p) && selected.has(p.code)}
                                          disabled={!canGrant(p)}
                                          onChange={(checked) => togglePermission(p.code, checked)}
                                          label={
                                            <span className={s.permTitle}>
                                              {p.label}
                                              {!p.active && (
                                                <TonePill tone='idle' icon={<IconLock size={11} />}>
                                                  No disponible
                                                </TonePill>
                                              )}
                                              {p.active && p.accessKind === 'escritura' && (
                                                <TonePill
                                                  tone={form.accessMode === 'escritura' ? 'warning' : 'idle'}
                                                  icon={form.accessMode === 'escritura' ? <IconPencil size={11} /> : <IconLock size={11} />}
                                                >
                                                  Escritura
                                                </TonePill>
                                              )}
                                              {p.active && permissionRequiresAgentCode(p.code) && (
                                                <TonePill tone='info' icon={<IconRobot size={11} />}>
                                                  Exige agente
                                                </TonePill>
                                              )}
                                            </span>
                                          }
                                          hint={p.description ?? undefined}
                                        />
                                      )).flatMap((row, i) => {
                                        const p = items[i];
                                        if (!PER_COMPANY_PERMISSION_SYSTEMS.includes(p.system) || !canGrant(p) || !selected.has(p.code)) {
                                          return [row];
                                        }
                                        const chosen = form.permissionCompanies[p.code] ?? [];
                                        return [
                                          row,
                                          <div key={p.code + '-companies'} className={s.permCompanies}>
                                            <span className={s.permCompaniesLabel}>
                                              {chosen.length > 0 ? 'Empresas · ' + chosen.length + ' de ' + restrictionOptions.length : 'Empresas'}
                                            </span>
                                            <MultiSelect
                                              aria-label={'Empresas donde vale «' + p.label + '»'}
                                              data={restrictionOptions}
                                              value={chosen}
                                              onChange={(ids) => setPermissionCompanies(p.code, ids, restrictionOptions.length)}
                                              placeholder={chosen.length > 0 ? undefined : 'Todas sus empresas'}
                                              searchable
                                              clearable
                                              size='xs'
                                              variant='filled'
                                              nothingFoundMessage='Ninguna empresa coincide'
                                              comboboxProps={{ withinPortal: true, zIndex: 350 }}
                                              style={{ flex: 1, minWidth: 0 }}
                                            />
                                          </div>,
                                        ];
                                      })}
                                    </div>
                                  </Collapse>
                                </div>
                              );
                            })}
                          </div>
                        </Collapse>
                      </div>
                    );
                  })}
                  {/* Copiar a otros (2026-11-11): los mismos permisos a agentes, personas de México u otros. */}
                  {clientId && client && (
                    <div className={s.card}>
                      <button
                        type='button'
                        className={s.actionRow}
                        disabled={dirty || saving}
                        onClick={() => setCopyOpen(true)}
                      >
                        <IconCopy size={18} />
                        Copiar estos permisos a otros clientes
                      </button>
                      {dirty && (
                        <div className={s.rowHint} style={{ padding: '0 14px 12px' }}>
                          Guarda primero los cambios: se copian los permisos guardados.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </InsetGroup>
            </>
          )}

          {/* ───────────── Llaves (solo quien se conecta por API) ───────────── */}
          {!usesApi || agentPending ? null : !clientId || !client ? (
            <InsetGroup label='Llaves'>
              <div className={s.keyRow}>
                <span className={s.keyIcon} aria-hidden>
                  <IconKey size={16} />
                </span>
                <span className={s.rowHint}>Crea el cliente para poder generar su llave.</span>
                <span />
              </div>
            </InsetGroup>
          ) : (
            <section className={s.stackSm}>
              {newKey && (
                <div className={`${s.newKey} ${toneClass('warning')}`} role='status'>
                  <div className={s.newKeyTitle}>
                    <IconAlertTriangle size={18} />
                    Copia la llave ahora
                  </div>
                  <div className={s.rowHint}>
                    Solo se muestra una vez. SynerLink no la guarda: si se pierde, hay que generar otra.
                  </div>
                  <div className={s.newKeyValue}>{newKey}</div>
                  <CopyButton value={newKey}>
                    {({ copied, copy }) => (
                      <Button
                        onClick={copy}
                        className={s.press}
                        color={copied ? 'green' : undefined}
                        leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        radius='xl'
                        style={{ justifySelf: 'start' }}
                      >
                        {copied ? 'Copiada' : 'Copiar llave'}
                      </Button>
                    )}
                  </CopyButton>
                </div>
              )}

              <InsetGroup
                label='Llaves activas'
                trailing={`${keys.length} de ${MAX_ACTIVE_KEYS}`}
                footer='Rotar revoca todas las llaves activas y genera una nueva en el mismo paso. Al vencer, la llave deja de funcionar y hay que generar otra.'
              >
                {keys.length === 0 ? (
                  <div className={s.keyRow}>
                    <span className={`${s.keyIcon}`} aria-hidden>
                      <IconKeyOff size={16} />
                    </span>
                    <span>
                      <TonePill tone='warning' icon={<IconKeyOff size={11} />}>
                        Sin llave activa
                      </TonePill>
                    </span>
                    <span />
                  </div>
                ) : (
                  keys.map((key) => (
                    <div key={key.id} className={s.keyRow}>
                      <span className={s.keyIcon} aria-hidden>
                        <IconKey size={16} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className={s.mono}>{key.prefix}…</div>
                        <div className={s.rowHint}>
                          Creada {formatDateTime(key.createdAt)} por {key.createdBy}
                          {' · '}
                          <span title={key.lastUsedAt ? formatDateTime(key.lastUsedAt) : undefined}>
                            Último uso: {formatRelative(key.lastUsedAt).toLowerCase()}
                          </span>
                        </div>
                        {key.expiresAt && (
                          <div style={{ marginTop: 4 }}>
                            {isKeyExpired(key.expiresAt) ? (
                              <TonePill tone='critical' icon={<IconClockX size={11} />}>
                                Vencida el {formatDateTime(key.expiresAt)}: genera una nueva
                              </TonePill>
                            ) : (
                              <TonePill tone='info' icon={<IconClock size={11} />}>
                                Vence el {formatDateTime(key.expiresAt)}
                              </TonePill>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type='button'
                        className={`${s.textDanger} ${s.press}`}
                        disabled={keyBusy}
                        onClick={() =>
                          setConfirm({
                            kind: 'revoke',
                            keyId: key.id,
                            prefix: key.prefix,
                          })
                        }
                        aria-label={`Revocar la llave ${key.prefix}`}
                      >
                        Revocar
                      </button>
                    </div>
                  ))
                )}
                <div className={s.row}>
                  <label className={s.rowLabel} htmlFor={`${titleId}-validity`}>
                    Vigencia de la llave nueva
                  </label>
                  <Select
                    id={`${titleId}-validity`}
                    data={API_KEY_VALIDITY_YEARS.map((years) => ({
                      value: String(years),
                      label: keyValidityLabel(years),
                    }))}
                    value={String(validityYears)}
                    onChange={(value) => setValidityYears((parseKeyValidityYears(Number(value)) ?? 0) as number)}
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: true, zIndex: 350 }}
                    variant='filled'
                    size='sm'
                    w={150}
                  />
                </div>
                <button
                  type='button'
                  className={s.actionRow}
                  style={{ borderTop: '1px solid var(--pn-hairline)' }}
                  disabled={keyBusy}
                  onClick={() => void generateKey(false)}
                >
                  {keyBusy && !confirm ? <Loader size={16} color='currentColor' /> : <IconPlus size={18} />}
                  Generar llave
                </button>
                {keys.length > 0 && (
                  <button
                    type='button'
                    className={`${s.actionRow} ${s.actionWarning}`}
                    disabled={keyBusy}
                    onClick={() => setConfirm({ kind: 'rotate' })}
                  >
                    <IconRotate size={18} />
                    Rotar llaves
                  </button>
                )}
              </InsetGroup>
            </section>
          )}

          {/* Eliminar el cliente de API (no el agente ni el portal): solo al editar. */}
          {clientId && (
            <section className={s.stackSm}>
              <InsetGroup footer='Borra sus permisos, empresas y llaves. No borra el agente de IA ni lo que un proveedor ve en el portal.'>
                <button
                  type='button'
                  className={s.actionRow}
                  style={{ color: 'var(--pn-critical-ink)' }}
                  disabled={saving || keyBusy || deleting}
                  onClick={() => setConfirm({ kind: 'delete' })}
                >
                  <IconTrash size={18} />
                  Eliminar cliente
                </button>
              </InsetGroup>
            </section>
          )}
        </div>

        {/* Pie de vidrio: qué falta o estado, y resumen */}
        <div className={s.sheetFooter}>
          <span className={`${s.footerState} ${toneClass(footerState.tone)}`} aria-live='polite'>
            {footerState.icon}
            {footerState.text}
          </span>
          {usesApi ? (
            <span>
              {form.allCompanies
                ? 'Todas las empresas'
                : `${companyCount} ${companyCount === 1 ? 'empresa' : 'empresas'}`}
              {' · '}
              {grantedCount} {grantedCount === 1 ? 'permiso' : 'permisos'}
            </span>
          ) : (
            <span>Portal de proveedores</span>
          )}
        </div>
    </>
  );

  return (
    <>
      {isPage ? (
        <div className={`${ps.root} ${s.root} ${s.pageShell}`}>{sheetInner}</div>
      ) : (
        <Modal
          opened={opened}
          onClose={requestClose}
          closeOnEscape={confirm === null}
          withCloseButton={false}
          fullScreen={isMobile}
          size={720}
          centered
          padding={0}
          aria-labelledby={titleId}
          overlayProps={{ backgroundOpacity: 0.35, blur: 4 }}
          transitionProps={{
            transition: isMobile ? 'slide-up' : 'pop',
            duration: reduceMotion ? 0 : 280,
            timingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          classNames={{
            content: `${ps.root} ${s.root} ${s.sheet} ${isMobile ? '' : s.sheetRounded}`,
            body: s.sheetBody,
          }}
        >
          {sheetInner}
        </Modal>
      )}

      <ActionSheet
        opened={confirm?.kind === 'discard'}
        title='¿Descartar los cambios?'
        message='Lo que cambiaste en este cliente no se guardará.'
        confirmLabel='Descartar cambios'
        cancelLabel='Seguir editando'
        onConfirm={() => {
          setConfirm(null);
          onClose();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ActionSheet
        opened={confirm?.kind === 'rotate'}
        title='¿Rotar las llaves?'
        message={`Se revocan ${keys.length === 1 ? 'la llave activa' : `las ${keys.length} llaves activas`} y se genera una nueva. Lo que use las anteriores dejará de funcionar en máximo 1 minuto.`}
        confirmLabel='Revocar y generar nueva'
        confirmIcon={<IconRotate size={18} />}
        loading={keyBusy}
        onConfirm={() => void generateKey(true)}
        onCancel={() => setConfirm(null)}
      />
      <ActionSheet
        opened={confirm?.kind === 'revoke'}
        title={confirm?.kind === 'revoke' ? `¿Revocar la llave ${confirm.prefix}…?` : '¿Revocar la llave?'}
        message='Lo que la use dejará de funcionar en máximo 1 minuto. No se puede deshacer.'
        confirmLabel='Revocar llave'
        confirmIcon={<IconTrash size={18} />}
        loading={keyBusy}
        onConfirm={() => {
          if (confirm?.kind === 'revoke') void revokeKey(confirm.keyId);
        }}
        onCancel={() => setConfirm(null)}
      />
      {client && (
        <CopyPermissionsDialog
          opened={copyOpen}
          source={client}
          clients={clients}
          permissions={permissions}
          onClose={() => setCopyOpen(false)}
          onCopied={() => onPermissionsCopied?.()}
        />
      )}
      <ActionSheet
        opened={confirm?.kind === 'enableWrite'}
        title='¿Permitir escritura?'
        message='Este cliente podrá cambiar datos con los permisos de escritura que le marques (crear solicitudes, agregar notas, subir adjuntos…). Mientras no marques ninguno, sigue solo consultando.'
        confirmLabel='Permitir escritura'
        confirmIcon={<IconPencil size={18} />}
        destructive={false}
        onConfirm={() => {
          setAccessMode('escritura');
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ActionSheet
        opened={confirm?.kind === 'delete'}
        title={`¿Eliminar «${client?.name ?? 'este cliente'}»?`}
        message={
          keys.length > 0
            ? `Se borran sus permisos y empresas, y ${keys.length === 1 ? 'su llave activa deja' : `sus ${keys.length} llaves activas dejan`} de funcionar en máximo 1 minuto. No se puede deshacer.`
            : 'Se borran sus permisos y empresas. No se puede deshacer.'
        }
        confirmLabel='Eliminar cliente'
        confirmIcon={<IconTrash size={18} />}
        loading={deleting}
        onConfirm={() => void deleteClient()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
