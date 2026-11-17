import { describe, expect, it } from 'vitest';
import {
  armarTablero,
  promedioCuatroSemanas,
  semaforoDe,
  usoActual,
  validarAsignacion,
  valorApi,
  type AgenteLicenciaDto,
} from '../licencias';

const AHORA = new Date('2026-11-17T12:00:00Z');
const ag = (p: Partial<AgenteLicenciaDto>): AgenteLicenciaDto => ({
  idAgent: 1,
  code: 'x',
  nombre: 'X',
  idEmpresa: 8,
  empresa: 'GSS',
  departamento: 'DESARROLLO',
  uso7d: 10,
  reinicio7d: null,
  uso5h: 0,
  overage: 'rejected',
  medidoEn: '2026-11-17T11:00:00Z',
  idLicencia: 1,
  idLicenciaPorHuella: null,
  huellaToken: null,
  consumoMes: { turnos: 0, tokens: 0, valorApi: 0 },
  consumoHoy: { turnos: 0, tokens: 0, valorApi: 0 },
  ultimoTurno: null,
  ...p,
});
const base = (p: Record<string, unknown> = {}) => ({
  idLicencia: 1,
  codigo: 'L01',
  nombre: null,
  idEmpresa: 8,
  empresa: 'GSS',
  organizacion: 'GSS principal',
  plan: 'Max',
  costoMensual: 100,
  moneda: 'USD',
  renovacion: null,
  responsable: null,
  notas: null,
  activa: true,
  huellas: [],
  agentes: [ag({})],
  semanas: [],
  ...p,
});

describe('licencias de Anthropic', () => {
  it('uso actual = el mayor de las mediciones recientes; ignora las viejas', () => {
    expect(usoActual([ag({ uso7d: 22 }), ag({ uso7d: 21 }), ag({ uso7d: 90, medidoEn: '2026-10-01T00:00:00Z' })], AHORA)).toBe(22);
    expect(usoActual([ag({ uso7d: null })], AHORA)).toBeNull();
  });

  it('promedio de las últimas 4 semanas y su pico; sin historial usa el uso actual', () => {
    const s = [10, 20, 30, 40, 99].map((v, i) => ({ reinicio: `2026-10-0${i + 1}T00:00:00Z`, pico: v }));
    // Toma las 4 últimas por fecha (20, 30, 40, 99).
    expect(promedioCuatroSemanas(s, 5)).toEqual({ promedio: 47.3, pico: 99 });
    expect(promedioCuatroSemanas([], 12)).toEqual({ promedio: 12, pico: 12 });
  });

  it('semáforo: verde < 60, amarillo 60–80, rojo > 80, gris sin dato', () => {
    expect(semaforoDe(59.9)).toBe('verde');
    expect(semaforoDe(60)).toBe('amarillo');
    expect(semaforoDe(80)).toBe('amarillo');
    expect(semaforoDe(80.1)).toBe('rojo');
    expect(semaforoDe(null)).toBe('gris');
  });

  it('regla de negocio: no se asigna un agente a la licencia de otra empresa', () => {
    expect(validarAsignacion(8, 8)).toBeNull();
    expect(validarAsignacion(3, 8)).toMatch(/no se comparte entre empresas/);
    expect(validarAsignacion(null, 8)).toMatch(/empresa principal/);
  });

  it('marca en rojo una licencia que mezcla empresas y la cuenta en el resumen', () => {
    const t = armarTablero(
      [base({ agentes: [ag({ nombre: 'Senhatsumi' }), ag({ idAgent: 2, nombre: 'Cosmo', idEmpresa: 3, empresa: 'ONELATAMPHARMA' })] })],
      [],
      [],
      [],
      AHORA,
    );
    const l = t.licencias[0];
    expect(l.alertas.find((a) => a.nivel === 'rojo')?.texto).toMatch(/Cosmo \(ONELATAMPHARMA\).*paga GSS/);
    expect(t.resumen.mezclanEmpresas).toBe(1);
    expect(l.costoPorAgente).toBe(50);
  });

  it('alerta de uso adicional pagado, de cupo alto y de costo faltante', () => {
    const semanas = [75, 80, 72, 77].map((v, i) => ({ reinicio: `2026-10-0${i + 1}T00:00:00Z`, pico: v }));
    const t = armarTablero([base({ costoMensual: null, semanas, agentes: [ag({ overage: 'allowed' })] })], [], [], [], AHORA);
    const textos = t.licencias[0].alertas.map((a) => a.texto).join(' | ');
    expect(textos).toMatch(/Uso adicional pagado/);
    expect(textos).toMatch(/no asignar más agentes/);
    expect(textos).toMatch(/Falta registrar el plan y el costo/);
    expect(t.resumen).toMatchObject({ conUsoAdicional: 1, noAsignarMas: 1, licenciasSinCosto: 1, costoMensual: 0 });
  });

  it('costo por empresa (paga) y por departamento (reparto igual entre agentes)', () => {
    const t = armarTablero(
      [
        base({ costoMensual: 200, agentes: [ag({}), ag({ idAgent: 2, departamento: 'CARTERA' })] }),
        base({ idLicencia: 2, codigo: 'L12', idEmpresa: 2, empresa: 'LABORATORIOS RYAN', costoMensual: 100, agentes: [ag({ idAgent: 3, idEmpresa: 2, departamento: 'PRODUCCIÓN' })] }),
      ],
      [],
      [],
      [],
      AHORA,
    );
    expect(t.porEmpresa.map((e) => [e.empresa, e.costoMensual])).toEqual([
      ['GSS', 200],
      ['LABORATORIOS RYAN', 100],
    ]);
    expect(t.porDepartamento.find((d) => d.departamento === 'CARTERA')?.costoMensual).toBe(100);
    expect(t.resumen.costoMensual).toBe(300);
  });

  it('valor equivalente en API por modelo principal; otros proveedores no se valoran', () => {
    const t1 = { entrada: 1_000_000, cacheEscritura: 1_000_000, cacheLectura: 10_000_000, salida: 1_000_000 };
    // Opus 5.5: 4 + 5 + 0,2×10 + 20 = 31
    expect(valorApi('claude-opus-5-5, claude-haiku-5-5', t1)).toBeCloseTo(31);
    expect(valorApi('anthropic/claude-sonnet-5-5', t1)).toBeCloseTo(2 + 2.5 + 2 + 10);
    expect(valorApi('openai/gpt-6.1-sol', t1)).toBe(0);
    expect(valorApi(null, t1)).toBe(0);
  });

  it('suma el consumo en vivo por licencia, empresa y resumen, y calcula cuántas veces rinde', () => {
    const c = (v: number) => ({ turnos: 2, tokens: 1000, valorApi: v });
    const a1 = ag({ consumoMes: c(300), consumoHoy: c(30), ultimoTurno: '2026-11-17T11:00:00Z' });
    const a2 = ag({ idAgent: 2, consumoMes: c(100), consumoHoy: c(0) });
    const t = armarTablero([base({ costoMensual: 100, agentes: [a1, a2] })], [], [], [], AHORA, { agentesActivos: [a1, a2] });
    expect(t.licencias[0].consumoMes.valorApi).toBe(400);
    expect(t.licencias[0].rendimiento).toBe(4);
    expect(t.porEmpresa[0].consumoMes.valorApi).toBe(400);
    expect(t.resumen.consumoHoy.valorApi).toBe(30);
    expect(t.resumen).toMatchObject({ agentesConConsumo: 1, agentesActivos: 2 });
  });
});
