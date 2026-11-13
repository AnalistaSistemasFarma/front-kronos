/**
 * Validación completa del cuerpo de crear/editar un cliente de API: reglas
 * puras (rules.ts) contra el catálogo ACTIVO de la base + empresas existentes
 * + el sujeto según el tipo (2026-11-09), cuyo nombre visible pone el servidor.
 */
import 'server-only';
import {
  PER_COMPANY_PERMISSION_SYSTEMS,
  PERMISSION_COMPANY_SYSTEM_MESSAGE,
  WRITE_PERMISSION_NEEDS_WRITE_MODE_MESSAGE,
  PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE,
  PORTAL_TERCEROS_UNREACHABLE_MESSAGE,
  subjectKindOf,
} from './constants';
import {
  agentExists,
  countExistingCompanies,
  findActiveExternalSystemName,
  findActiveSynerlinkUser,
  listPermissions,
} from './db';
import { findPortalTerceroByNit } from './portal-terceros';
import { parseApiClientInput, type ApiClientInput, type ParseResult } from './rules';
import { clampSubjectLabel } from './subject-rules';

/**
 * Confirma que el sujeto existe y devuelve su nombre visible. Falla cerrado:
 * si la API SAP no responde, no se guarda.
 */
async function resolveSubjectLabel(input: ApiClientInput): Promise<ParseResult<string | null>> {
  const kind = subjectKindOf(input.clientType);
  const ref = input.subjectRef;
  if (!kind || !ref) return { ok: true, value: null };

  if (kind === 'tercero') {
    const found = await findPortalTerceroByNit(ref);
    if (found.status === 'not_configured') return { ok: false, error: PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE };
    if (found.status === 'error') return { ok: false, error: PORTAL_TERCEROS_UNREACHABLE_MESSAGE };
    if (!found.value) return { ok: false, error: 'Ese NIT no existe en SAP en ninguna empresa' };
    return { ok: true, value: clampSubjectLabel(found.value.nombre ?? found.value.nit) };
  }

  // Persona de México: no hay padrón que consultar; su nombre visible es el nombre del cliente.
  if (kind === 'persona') return { ok: true, value: clampSubjectLabel(input.name) };

  if (kind === 'usuario') {
    const user = await findActiveSynerlinkUser(ref);
    if (!user) return { ok: false, error: 'El usuario de SynerLink no existe o está inactivo' };
    return { ok: true, value: clampSubjectLabel(user.name || user.email) };
  }

  const name = await findActiveExternalSystemName(Number(ref));
  if (!name) return { ok: false, error: 'El sistema no existe o está inactivo' };
  return { ok: true, value: clampSubjectLabel(name) };
}

export async function validateApiClientBody(body: unknown): Promise<ParseResult<ApiClientInput>> {
  const permissions = await listPermissions();
  const known = new Set(permissions.filter((p) => p.active).map((p) => p.code));
  const parsed = parseApiClientInput(body, known);
  if (!parsed.ok) return parsed;
  // Nivel de acceso (2026-11-11): en solo lectura no se guardan permisos que escriben.
  if (parsed.value.accessMode !== 'escritura') {
    const writeCodes = new Set(permissions.filter((p) => p.accessKind === 'escritura').map((p) => p.code));
    if (parsed.value.permissionCodes.some((code) => writeCodes.has(code))) {
      return { ok: false, error: WRITE_PERMISSION_NEEDS_WRITE_MODE_MESSAGE };
    }
  }
  // Permisos por empresa (2026-11-11): solo los de SAP, y sus empresas tienen que existir.
  const restricted = Object.keys(parsed.value.permissionCompanies);
  if (restricted.length > 0) {
    const systemOf = new Map(permissions.map((p) => [p.code, p.system]));
    if (restricted.some((code) => !PER_COMPANY_PERMISSION_SYSTEMS.includes(systemOf.get(code) ?? ''))) {
      return { ok: false, error: PERMISSION_COMPANY_SYSTEM_MESSAGE };
    }
  }
  const { companyIds, clientType, agentCode } = parsed.value;
  const restrictedCompanyIds = [...new Set(Object.values(parsed.value.permissionCompanies).flat())].filter(
    (id) => !companyIds.includes(id)
  );
  // Un cliente tipo «agente» se amarra a un agente real de SynerLink (se elige de la lista).
  if (clientType === 'agente' && !agentCode) {
    return { ok: false, error: 'Elige el agente' };
  }
  // Las tres comprobaciones son independientes: van en paralelo (antes, una tras otra). Se responde
  // con el primer error en el mismo orden de siempre: agente, empresas, sujeto.
  const [agentOk, companiesOk, label] = await Promise.all([
    agentCode ? agentExists(agentCode) : Promise.resolve(true),
    companyIds.length + restrictedCompanyIds.length > 0
      ? countExistingCompanies([...companyIds, ...restrictedCompanyIds]).then(
          (n) => n === companyIds.length + restrictedCompanyIds.length
        )
      : Promise.resolve(true),
    resolveSubjectLabel(parsed.value),
  ]);
  if (!agentOk) return { ok: false, error: 'El agente no existe' };
  if (!companiesOk) return { ok: false, error: 'Empresas no válidas' };
  if (!label.ok) return label;
  return { ok: true, value: { ...parsed.value, subjectLabel: label.value } };
}
