import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pruebas de las rutas de Autorizaciones con la sesión y la base simuladas.
// Objetivo (hotfix de seguridad): el usuario sale SIEMPRE de la sesión del servidor,
// nunca de un parámetro del cliente, y el pool solo muestra tareas sin asignar.

const { getServerSession, findUnique, mssqlRequest, getPool } = vi.hoisted(() => {
  const mssqlRequest = {
    inputs: {} as Record<string, unknown>,
    queries: [] as string[],
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    },
    async query(q: string) {
      this.queries.push(q);
      return { recordset: [] };
    },
  };
  const pool = { request: () => mssqlRequest };
  return {
    getServerSession: vi.fn(),
    findUnique: vi.fn(),
    mssqlRequest,
    getPool: vi.fn(async () => pool),
  };
});

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { user: { findUnique } } }));
vi.mock('../../../../dbconfig', () => ({ default: {} }));
vi.mock('mssql', () => ({
  default: { connect: getPool, NVarChar: 'NVarChar', Int: 'Int', DateTime: 'DateTime' },
}));
vi.mock('../../../../lib/mssqlPool', () => ({
  getPool,
  sql: { NVarChar: () => 'NVarChar' },
}));
vi.mock('../../../../lib/orion/service', () => ({ loadOrionFormBag: vi.fn() }));

import { GET as getActivities } from '../authorization-activities/route';
import { GET as getDepartments } from '../authorization-departments/route';
import { GET as getViewActivities } from '../../requests-general/view-activities/route';

const SESSION_USER = { id: 'cuid-de-la-sesion', email: 'aprobador.a@gsslatam.com', isActive: true };

function sessionActiva() {
  getServerSession.mockResolvedValue({ user: { email: SESSION_USER.email } });
  findUnique.mockResolvedValue(SESSION_USER);
}

beforeEach(() => {
  getServerSession.mockReset();
  findUnique.mockReset();
  getPool.mockClear();
  mssqlRequest.inputs = {};
  mssqlRequest.queries = [];
});

describe('GET /api/authorization/authorization-activities', () => {
  it('sin sesión responde 401 y no consulta la base', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await getActivities(
      new Request('http://x/api/authorization/authorization-activities?idUser=otro')
    );
    expect(res.status).toBe(401);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('con un usuario inactivo responde 401', async () => {
    getServerSession.mockResolvedValue({ user: { email: SESSION_USER.email } });
    findUnique.mockResolvedValue({ ...SESSION_USER, isActive: false });
    const res = await getActivities(new Request('http://x/api/authorization/authorization-activities'));
    expect(res.status).toBe(401);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('ignora el idUser del cliente y usa el usuario de la sesión', async () => {
    sessionActiva();
    const res = await getActivities(
      new Request('http://x/api/authorization/authorization-activities?idUser=cuid-de-otra-persona&status=0')
    );
    expect(res.status).toBe(200);
    expect(mssqlRequest.inputs.idUser).toBe('cuid-de-la-sesion');
    expect(Object.values(mssqlRequest.inputs)).not.toContain('cuid-de-otra-persona');
  });

  it('funciona sin idUser en la query (el front ya no lo envía)', async () => {
    sessionActiva();
    const res = await getActivities(new Request('http://x/api/authorization/authorization-activities'));
    expect(res.status).toBe(200);
    expect(mssqlRequest.inputs.idUser).toBe('cuid-de-la-sesion');
  });

  it('el pool solo incluye tareas sin persona asignada', async () => {
    sessionActiva();
    await getActivities(new Request('http://x/api/authorization/authorization-activities'));
    const query = mssqlRequest.queries[0].replace(/\s+/g, ' ');
    expect(query).toContain('trg.id_assigned = @idUser OR ( trg.id_assigned IS NULL AND c.id_company IN');
  });

  it('si la base falla responde 500 sin filtrar el detalle del error', async () => {
    sessionActiva();
    getPool.mockRejectedValueOnce(new Error('Login failed for user secreto'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await getActivities(new Request('http://x/api/authorization/authorization-activities'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secreto');
    spy.mockRestore();
  });
});

describe('GET /api/authorization/authorization-departments', () => {
  it('sin sesión responde 401 y no consulta la base', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await getDepartments();
    expect(res.status).toBe(401);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('siempre filtra por el usuario de la sesión', async () => {
    sessionActiva();
    const res = await getDepartments();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ departments: [] });
    expect(mssqlRequest.inputs.userId).toBe('cuid-de-la-sesion');
    expect(mssqlRequest.queries[0]).toContain('WHERE du.id_user = @userId');
  });
});

describe('GET /api/requests-general/view-activities (lo abre Autorizaciones → ver tarea)', () => {
  it('sin sesión responde 401 con ?id= y no consulta la base', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await getViewActivities(new Request('http://x/api/requests-general/view-activities?id=123'));
    expect(res.status).toBe(401);
    expect(getPool).not.toHaveBeenCalled();
  });
});
