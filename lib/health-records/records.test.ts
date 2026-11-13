import { describe, it, expect, vi } from 'vitest';

vi.mock('../sap/serviceLayer', () => ({
  sapGet: vi.fn(async (_session: unknown, path: string) => {
    if (path.startsWith('UserObjectsMD')) return { TableName: 'FAR_REGISANITARIO' };
    return {
      value: [
        { Name: 'Titular', Type: 'db_Alpha', EditSize: 100 },
        { Name: 'SEND_Link', Type: 'db_Memo', EditSize: 254 },
        { Name: 'Vencimiento', Type: 'db_Date', EditSize: 8 },
      ],
    };
  }),
  sapGetAll: vi.fn(),
  sapPost: vi.fn(),
  sapPatch: vi.fn(),
  sapDelete: vi.fn(),
}));

import { getFieldSizes, validarLargos } from './records';

describe('getFieldSizes', () => {
  it('registra solo los db_Alpha; los db_Memo (enlace) no tienen tope', async () => {
    const sizes = await getFieldSizes({} as never, 'FAR_RegiSanitario');
    expect(sizes).toEqual({ U_Titular: 100 });
    expect(sizes).not.toHaveProperty('U_SEND_Link');
  });
});

describe('validarLargos', () => {
  it('no bloquea un enlace de 600 caracteres', async () => {
    const sizes = await getFieldSizes({} as never, 'FAR_RegiSanitario');
    const link = 'https://example.com/' + 'a'.repeat(580);
    expect(link.length).toBe(600);
    expect(validarLargos({ U_SEND_Link: link } as never, sizes)).toBeNull();
  });

  it('sigue bloqueando un db_Alpha que supera su EditSize', () => {
    const msg = validarLargos({ U_Titular: 'x'.repeat(101) } as never, { U_Titular: 100 });
    expect(msg).toMatch(/máximo 100 caracteres/);
  });
});
