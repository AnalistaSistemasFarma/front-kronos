/** Tipos de la pestaña «Permisos API» (lo que devuelve /api/administration/api-clients). */
import type { ApiAccessMode, ApiClientType, ApiPermissionAccessKind } from '@/lib/api-permissions/constants';

export interface ApiPermissionItem {
  code: string;
  /** Plataforma: synerlink, portal_terceros, sap… (api_permission.system). */
  system: string;
  groupLabel: string;
  label: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  /** 'escritura' = solo se marca si el cliente tiene «Permitir escritura» (2026-11-11). */
  accessKind: ApiPermissionAccessKind;
}

export interface CompanyItem {
  id: number;
  name: string;
}

export interface ApiClientKeyItem {
  id: number;
  prefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  /** Cuándo vence (null = no vence). */
  expiresAt: string | null;
}

export interface ApiClientItem {
  id: number;
  name: string;
  clientType: ApiClientType;
  description: string | null;
  agentCode: string | null;
  /** Sujeto según el tipo (NIT, id de usuario o id de sistema) y su nombre visible. */
  subjectRef: string | null;
  subjectLabel: string | null;
  /** Nivel de acceso: solo lectura o lectura y escritura (2026-11-11). */
  accessMode: ApiAccessMode;
  allCompanies: boolean;
  companyIds: number[];
  permissionCodes: string[];
  /** Permisos limitados a algunas empresas (código → empresas). Lo que no está aquí vale en todas. */
  permissionCompanies: Record<string, number[]>;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  keys: ApiClientKeyItem[];
  lastUsedAt: string | null;
}

/** Agente de IA de SynerLink que se elige para un cliente tipo «agente». */
export interface AgentItem {
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

/** Proveedor o cliente de SAP, agrupado por NIT (GET …/subjects/portal-terceros). */
export interface PortalTerceroItem {
  nit: string;
  nombre: string | null;
  empresas: { clave: string; nombre: string }[];
  /** «Proveedor», «Cliente», «Proveedor y cliente» o null. */
  tipo: string | null;
}

/** Usuario activo de SynerLink (GET …/subjects/synerlink-users). */
export interface SynerlinkUserItem {
  id: string;
  name: string | null;
  email: string;
}

/** Sistema externo (GET …/external-systems). */
export interface ExternalSystemItem {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  clientCount: number;
}

export interface ApiClientsResponse {
  clients: ApiClientItem[];
  permissions: ApiPermissionItem[];
  companies: CompanyItem[];
  agents: AgentItem[];
}

/** «hace 5 min», «hace 3 días»… para actividad (último uso). null = «Sin uso». */
export function formatRelative(value: string | null, nowMs: number = Date.now()): string {
  if (!value) return 'Sin uso';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  const minutes = Math.max(0, Math.floor((nowMs - time) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'hace 1 hora' : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'hace 1 día' : `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  const years = Math.floor(days / 365);
  return years <= 1 ? 'hace 1 año' : `hace ${years} años`;
}

/** ¿Sin uso en los últimos `days` días (o nunca)? */
export function unusedFor(value: string | null, days: number, nowMs: number = Date.now()): boolean {
  if (!value) return true;
  const time = new Date(value).getTime();
  return Number.isNaN(time) || nowMs - time > days * 86_400_000;
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
}
