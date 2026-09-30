import { describe, expect, it, vi } from 'vitest';
import { getActiveSgcCompanyIds, getSgcAccessForUser, type SgcAccessDb } from '../access';
import { SGC_SUBPROCESS_URLS } from '../constants';

function fakeDb(grants: { url: string; id: number; name: string }[], activeIds: number[]) {
  const subprocessFindMany = vi.fn().mockResolvedValue(
    grants.map((g) => ({
      subprocess: { subprocess_url: g.url },
      companyUser: { company: { id_company: g.id, company: g.name } },
    }))
  );
  const configFindMany = vi.fn().mockResolvedValue(activeIds.map((id) => ({ id_company: id })));
  const db = {
    subprocessUserCompany: { findMany: subprocessFindMany },
    sgcCompanyConfig: { findMany: configFindMany },
  } as unknown as SgcAccessDb;
  return { db, subprocessFindMany, configFindMany };
}

describe('SGC · lectura del acceso desde la base', () => {
  it('[SGC-REQ-004] solo toma como activas las empresas con is_active = 1', async () => {
    const { db, configFindMany } = fakeDb([], [3]);
    expect(await getActiveSgcCompanyIds(db)).toEqual([3]);
    expect(configFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { is_active: true } }));
  });

  it('[SGC-REQ-005] consulta solo los subprocesos del SGC del correo pedido', async () => {
    const { db, subprocessFindMany } = fakeDb(
      [{ url: SGC_SUBPROCESS_URLS.gestion, id: 3, name: 'ONELATAMPHARMA' }],
      [3]
    );
    const access = await getSgcAccessForUser(db, 'nicolas.rivera@gsslatam.com');
    const where = subprocessFindMany.mock.calls[0][0].where;
    expect(where.companyUser).toEqual({ user: { email: 'nicolas.rivera@gsslatam.com' } });
    expect(where.subprocess.subprocess_url.in).toEqual(Object.values(SGC_SUBPROCESS_URLS));
    expect(access).toEqual([
      { idCompany: 3, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: false, canAdminFlows: false },
    ]);
  });

  it('[SGC-REQ-004] con permisos pero sin empresa activa devuelve lista vacía', async () => {
    const { db } = fakeDb([{ url: SGC_SUBPROCESS_URLS.lectura, id: 1, name: 'FARMALOGICA S.A.' }], [3]);
    expect(await getSgcAccessForUser(db, 'x@gsslatam.com')).toEqual([]);
  });
});
