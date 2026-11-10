import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../mssqlPool', () => ({ sql: {}, withMssqlPool: vi.fn() }));
vi.mock('../../chat/audit-access', () => ({ agentInScope: () => true }));
vi.mock('../inventory', () => ({ ocultarSecretos: (x: unknown) => x }));

import { consolidarDepartamentos, type AgenteIndicadorDto } from '../automation-db';

/* Indicador de automatizaciones → consolidado por departamento (revisión del 2026-11-09). */

const agente = (over: Partial<AgenteIndicadorDto>): AgenteIndicadorDto => ({
  idAgent: 1,
  code: 'a',
  displayName: 'A',
  empresa: 'OLP',
  departamento: 'COMPRAS',
  casos: 1,
  casosValidos: 1,
  ocurrencias: 10,
  horasAntes: 10,
  horasDespues: 2,
  horasAhorradas: 8,
  horasMes: 4,
  reduccion: 80,
  ...over,
});

describe('consolidarDepartamentos', () => {
  it('suma por departamento, calcula el % liberado y ordena por horas liberadas al mes', () => {
    const r = consolidarDepartamentos([
      agente({ idAgent: 1, departamento: 'COMPRAS 🛒' }),
      agente({ idAgent: 2, departamento: 'Compras', horasAntes: 6, horasDespues: 3, horasAhorradas: 3, horasMes: 1.5 }),
      agente({ idAgent: 3, departamento: 'SISTEMAS', horasAntes: 40, horasDespues: 10, horasAhorradas: 30, horasMes: 15 }),
      agente({ idAgent: 4, departamento: null, horasMes: 0.5 }),
    ]);
    expect(r.map((d) => d.departamento)).toEqual(['SISTEMAS', 'COMPRAS', 'Sin departamento']);
    expect(r[1]).toMatchObject({ agentes: 2, horasSinIA: 16, horasConIA: 5, horasPeriodo: 11, horasMes: 5.5, porcentaje: 68.8 });
  });
});
