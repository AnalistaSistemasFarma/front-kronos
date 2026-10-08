import { describe, expect, it } from 'vitest';
import { toSyncUsers } from '../userSync';

const tenantMap: Record<number, string> = { 1: 'farmalogica', 3: 'farmalogica-1', 8: 'gss' };

function row(id_company: number | null, perms: { firma?: boolean; sign?: boolean } = {}) {
  return {
    id: 'u1',
    name: 'Ana Pérez',
    email: 'Ana.Perez@Empresa.com ',
    identification: null,
    id_company,
    department_name: null,
    has_firma: perms.firma ? 1 : 0,
    has_sign: perms.sign ? 1 : 0,
  };
}

describe('toSyncUsers', () => {
  it('empresa predefinida = primera empresa en Orion, aunque no tenga permiso de firmas', () => {
    const { users } = toSyncUsers([row(3), row(1)], tenantMap);
    expect(users[0].synerlinkCompanyId).toBe(3);
    expect(users[0].additionalCompanyIds).toEqual([]);
    expect(users[0].canSign).toBe(false);
    expect(users[0].email).toBe('ana.perez@empresa.com');
  });

  it('otras empresas solo con permiso de firmas en esa empresa', () => {
    const { users } = toSyncUsers(
      [row(3), row(1, { firma: true, sign: true }), row(8)],
      tenantMap
    );
    expect(users[0].synerlinkCompanyId).toBe(3);
    expect(users[0].additionalCompanyIds).toEqual([1]);
    expect(users[0].canSign).toBe(true);
  });

  it('ignora empresas que no existen en Orion y omite al usuario sin ninguna', () => {
    const withUnknown = toSyncUsers([row(99, { firma: true }), row(8)], tenantMap);
    expect(withUnknown.users[0].synerlinkCompanyId).toBe(8);

    const none = toSyncUsers([row(99), row(null)], tenantMap);
    expect(none.users).toHaveLength(0);
    expect(none.skipped).toEqual(['ana.perez@empresa.com']);
  });
});
