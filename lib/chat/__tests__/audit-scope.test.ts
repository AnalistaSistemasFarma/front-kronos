import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Alcance por empresa de la Auditoría de agentes (2026-10-06): la
 * administración ve todo; los demás, solo los agentes de las empresas donde
 * tienen el subproceso. El texto, solo donde tienen LOS DOS permisos.
 */
const admin = vi.hoisted(() => vi.fn());
const findSubprocesses = vi.hoisted(() => vi.fn());
const findAgentCompanies = vi.hoisted(() => vi.fn());
const findAgent = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({
  prisma: {
    subprocessUserCompany: { findMany: findSubprocesses },
    agentCompany: { findMany: findAgentCompanies },
    agent: { findUnique: findAgent },
  },
}));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: admin }));

import {
  agentCodeInScope,
  AUDIT_CONVERSATIONS_URL,
  AUDIT_MODULE_URL,
  conversationInScope,
  conversationScopeWhere,
  getAuditScope,
  getAuditTextScope,
} from '../audit-access';

/** Empresas por subproceso, como las devolvería subprocess_user_company. */
function asignaciones(porUrl: Record<string, number[]>) {
  findSubprocesses.mockImplementation(
    async (args: { where: { subprocess: { subprocess_url: string } } }) =>
      (porUrl[args.where.subprocess.subprocess_url] ?? []).map((id) => ({
        companyUser: { id_company: id },
      }))
  );
}

/** Agentes por empresa, como los devolvería agent_company. */
function agentesPorEmpresa(mapa: Record<number, number[]>) {
  findAgentCompanies.mockImplementation(
    async (args: { where: { id_company: { in: number[] } } }) =>
      args.where.id_company.in.flatMap((c) => (mapa[c] ?? []).map((a) => ({ id_agent: a })))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue(false);
  asignaciones({});
  agentesPorEmpresa({ 3: [10, 11], 11: [20, 10] });
});

describe('getAuditScope', () => {
  it('la administración ve todo sin consultar empresas', async () => {
    admin.mockResolvedValue(true);
    expect(await getAuditScope('nicolas@gsslatam.com')).toEqual({ all: true });
    expect(findSubprocesses).not.toHaveBeenCalled();
  });

  it('fuera de la administración, solo las empresas del subproceso y sus agentes', async () => {
    asignaciones({ [AUDIT_MODULE_URL]: [11, 11] });
    expect(await getAuditScope('christian.bock@unidossis.com.co')).toEqual({
      all: false,
      companyIds: [11],
      agentIds: [10, 20],
    });
  });

  it('sin el subproceso en ninguna empresa, alcance vacío', async () => {
    expect(await getAuditScope('nadie@gsslatam.com')).toEqual({
      all: false,
      companyIds: [],
      agentIds: [],
    });
    expect(findAgentCompanies).not.toHaveBeenCalled();
  });

  it('un correo vacío no tiene alcance', async () => {
    expect(await getAuditScope('  ')).toEqual({ all: false, companyIds: [], agentIds: [] });
    expect(admin).not.toHaveBeenCalled();
  });
});

describe('getAuditTextScope', () => {
  it('sin el permiso de conversaciones no hay texto, ni siquiera para la administración', async () => {
    expect(await getAuditTextScope('nicolas@gsslatam.com', { all: true })).toBeNull();
  });

  it('la administración con el permiso lee en todo su alcance', async () => {
    asignaciones({ [AUDIT_CONVERSATIONS_URL]: [1] });
    expect(await getAuditTextScope('nicolas@gsslatam.com', { all: true })).toEqual({ all: true });
  });

  it('fuera de la administración, solo donde tiene los dos permisos', async () => {
    asignaciones({ [AUDIT_CONVERSATIONS_URL]: [3, 11] });
    const alcance = { all: false as const, companyIds: [3], agentIds: [10, 11] };
    expect(await getAuditTextScope('andrea.duque@onelatampharma.com', alcance)).toEqual({
      all: false,
      companyIds: [3],
      agentIds: [10, 11],
    });
  });

  it('el permiso de conversaciones en otra empresa no da texto', async () => {
    asignaciones({ [AUDIT_CONVERSATIONS_URL]: [11] });
    const alcance = { all: false as const, companyIds: [3], agentIds: [10, 11] };
    expect(await getAuditTextScope('andrea.duque@onelatampharma.com', alcance)).toBeNull();
  });
});

describe('filtros del alcance', () => {
  const alcance = { all: false as const, companyIds: [11], agentIds: [20] };

  it('alcance total: sin filtro', () => {
    expect(conversationScopeWhere({ all: true })).toEqual({});
    expect(conversationInScope({ all: true }, { kind: 'people', id_agent: 1, id_company: null })).toBe(true);
  });

  it('directos por agente, grupos por empresa, nunca entre personas', () => {
    expect(conversationScopeWhere(alcance)).toEqual({
      OR: [
        { kind: 'direct', id_agent: { in: [20] } },
        { kind: 'group', id_company: { in: [11] } },
      ],
    });
    expect(conversationInScope(alcance, { kind: 'direct', id_agent: 20, id_company: null })).toBe(true);
    expect(conversationInScope(alcance, { kind: 'direct', id_agent: 99, id_company: null })).toBe(false);
    expect(conversationInScope(alcance, { kind: 'group', id_agent: 99, id_company: 11 })).toBe(true);
    expect(conversationInScope(alcance, { kind: 'group', id_agent: 20, id_company: 3 })).toBe(false);
    expect(conversationInScope(alcance, { kind: 'people', id_agent: 20, id_company: 11 })).toBe(false);
  });

  it('hoja de vida: el agente debe estar en el alcance', async () => {
    findAgent.mockResolvedValueOnce({ id_agent: 20 }).mockResolvedValueOnce({ id_agent: 99 });
    expect(await agentCodeInScope(alcance, 'tesa')).toBe(true);
    expect(await agentCodeInScope(alcance, 'horus')).toBe(false);
    findAgent.mockResolvedValueOnce(null);
    expect(await agentCodeInScope(alcance, 'no-existe')).toBe(false);
    expect(await agentCodeInScope({ all: true }, 'horus')).toBe(true);
  });
});
