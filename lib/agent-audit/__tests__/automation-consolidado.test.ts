import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../mssqlPool', () => ({ sql: {}, withMssqlPool: vi.fn() }));
vi.mock('../../chat/audit-access', () => ({ agentInScope: () => true }));
vi.mock('../inventory', () => ({ ocultarSecretos: (x: unknown) => x }));

import {
  armarDetalleSemana,
  armarGraficos,
  consolidarDepartamentos,
  type AgenteIndicadorDto,
} from '../automation-db';

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

describe('armarDetalleSemana (clic en una celda del mapa de calor, 2026-11-10)', () => {
  const agentes = [
    agente({ idAgent: 1, code: 'cosmo', displayName: 'Cosmo', departamento: 'GERENCIA' }),
    agente({ idAgent: 2, code: 'pedroloro', displayName: 'Pedro loro', departamento: 'Gerencia' }),
    agente({ idAgent: 3, code: 'lexa', displayName: 'Lexa', departamento: 'JURÍDICO' }),
  ];
  const caso = (id: number, clave: string, mh: number, md: number, semanas: unknown) => ({
    id_agent: id, clave, caso: `Caso ${clave}`, min_humano: mh, min_despues: md, valido: true,
    pasos_json: JSON.stringify([{ paso: 'Buscar datos', minutos: mh }]), supuestos: 'x',
    semanas_json: JSON.stringify(semanas),
  });
  const casos = [
    caso(1, 'C1', 60, 10, [{ inicio: '2026-11-02', ocurrencias: 3 }, { inicio: '2026-10-26', ocurrencias: 1 }]),
    caso(2, 'C2', 45, 7, [{ inicio: '2026-11-02', ocurrencias: 5 }]),
    caso(2, 'C3', 20, 5, [{ inicio: '2026-10-26', ocurrencias: 2 }]),
    caso(3, 'C4', 90, 15, [{ inicio: '2026-11-02', ocurrencias: 4 }]),
  ];

  it('los totales y el % coinciden con la celda del mapa de calor', () => {
    const g = armarGraficos(agentes, casos);
    const fila = g.departamentos.find((d) => d.departamento === 'GERENCIA')!;
    expect(fila.agentes).toEqual(expect.arrayContaining(['Cosmo', 'Pedro loro']));
    const c = fila.celdas.find((x) => x.semana === '2026-11-02')!;
    const d = armarDetalleSemana(agentes, casos, 'GERENCIA', '2026-11-02', '2026-11-09');
    expect(d.horasSinIA).toBe(c.horasSinIA);
    expect(d.horasConIA).toBe(c.horasConIA);
    expect(d.mejora).toBe(c.mejora);
    expect(d.horasLiberadas).toBeCloseTo(c.horasSinIA - c.horasConIA, 5);
    expect(d.semanaHasta).toBe('2026-11-08');
  });

  it('lista solo los casos del departamento y la semana, de mayor a menor ahorro', () => {
    const d = armarDetalleSemana(agentes, casos, 'GERENCIA', '2026-11-02', null);
    expect(d.items.map((i) => i.clave)).toEqual(['C2', 'C1']);
    expect(d.items[0]).toMatchObject({ agente: 'Pedro loro', ocurrencias: 5, horasLiberadas: 3.2 });
    expect(d.items[0].pasos).toEqual([{ paso: 'Buscar datos', minutos: 45 }]);
    expect(d.ocurrencias).toBe(8);
    expect(d.agentes.map((a) => a.code)).toEqual(['pedroloro', 'cosmo']);
  });
});
