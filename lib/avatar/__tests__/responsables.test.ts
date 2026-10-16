import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Quién puede cambiar el avatar de un asistente cuando la base NO tiene la
 * hoja de vida de agentes (dbo.agent_profile), como hoy en producción:
 * solo los administradores. Con la tabla, la regla de siempre.
 */

const estado = vi.hoisted(() => ({
  tablaExiste: false,
  responsables: [] as number[],
  consultas: [] as string[],
  errorEnConsulta: null as null | { number: number },
}));

vi.mock('../../mssqlPool', () => {
  const pool = {
    request() {
      const req = {
        input: () => req,
        async query(texto: string) {
          estado.consultas.push(texto);
          if (texto.includes('OBJECT_ID')) {
            return { recordset: [{ oid: estado.tablaExiste ? 123 : null }] };
          }
          if (estado.errorEnConsulta) throw estado.errorEnConsulta;
          return { recordset: estado.responsables.map((id_agent) => ({ id_agent })) };
        },
      };
      return req;
    },
  };
  return {
    sql: { NVarChar: () => 'nvarchar', Int: 'int' },
    withMssqlPool: async (fn: (p: typeof pool) => unknown) => fn(pool),
  };
});

const esAdmin = vi.hoisted(() => ({ valor: false }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: vi.fn(async () => esAdmin.valor) }));
vi.mock('../../chat/access', () => ({
  getChatAccess: vi.fn(async () => ({
    canUseChat: true,
    agents: [
      { idAgent: 1, code: 'horus', displayName: 'Horus', avatarUrl: null, avatarVersion: null },
      { idAgent: 2, code: 'orion', displayName: 'Orión', avatarUrl: null, avatarVersion: null },
    ],
  })),
}));
// Si el servicio volviera a usar prisma.agentProfile, esta prueba fallaría: el doble no lo trae.
vi.mock('../../prisma', () => ({ prisma: {} }));
vi.mock('../store', () => ({
  AvatarStoreUnavailableError: class extends Error {},
  readAvatarConfigs: vi.fn(async () => new Map()),
  readAvatarConfig: vi.fn(),
  upsertAvatarConfig: vi.fn(),
  deleteAvatarConfig: vi.fn(),
}));

import { readAgentOwnerIds } from '../responsables';
import { listManagedAgents } from '../service';

beforeEach(() => {
  estado.tablaExiste = false;
  estado.responsables = [];
  estado.consultas = [];
  estado.errorEnConsulta = null;
  esAdmin.valor = false;
});

describe('readAgentOwnerIds', () => {
  it('sin la tabla agent_profile devuelve vacío y no la consulta', async () => {
    const r = await readAgentOwnerIds('ana@gsslatam.com', [1, 2]);
    expect(r.size).toBe(0);
    expect(estado.consultas.some((q) => q.includes('FROM dbo.agent_profile'))).toBe(false);
  });

  it('con la tabla devuelve los agentes de los que es responsable', async () => {
    estado.tablaExiste = true;
    estado.responsables = [2];
    const r = await readAgentOwnerIds('ana@gsslatam.com', [1, 2]);
    expect([...r]).toEqual([2]);
  });

  it('si la tabla desaparece entre la verificación y la consulta (error 208) devuelve vacío', async () => {
    estado.tablaExiste = true;
    estado.errorEnConsulta = { number: 208 };
    await expect(readAgentOwnerIds('ana@gsslatam.com', [1])).resolves.toEqual(new Set());
  });

  it('otros errores de SQL no se esconden', async () => {
    estado.tablaExiste = true;
    estado.errorEnConsulta = { number: 18456 };
    await expect(readAgentOwnerIds('ana@gsslatam.com', [1])).rejects.toEqual({ number: 18456 });
  });
});

describe('listManagedAgents sin la tabla agent_profile', () => {
  it('una persona que no es administradora no gestiona ningún asistente', async () => {
    expect(await listManagedAgents('ana@gsslatam.com')).toEqual([]);
  });

  it('un administrador gestiona todos los asistentes que ve, como administrador', async () => {
    esAdmin.valor = true;
    const lista = await listManagedAgents('admin@gsslatam.com');
    expect(lista.map((a) => [a.code, a.motivo])).toEqual([
      ['horus', 'administrador'],
      ['orion', 'administrador'],
    ]);
  });
});

describe('listManagedAgents con la tabla agent_profile', () => {
  it('el responsable gestiona su asistente aunque no sea administrador', async () => {
    estado.tablaExiste = true;
    estado.responsables = [2];
    const lista = await listManagedAgents('ana@gsslatam.com');
    expect(lista.map((a) => [a.code, a.motivo])).toEqual([['orion', 'responsable']]);
  });
});
