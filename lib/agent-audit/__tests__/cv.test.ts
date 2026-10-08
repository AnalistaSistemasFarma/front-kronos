import { describe, expect, it } from 'vitest';
import {
  cambiosPerfil,
  consumoPorDia,
  contarSeveridades,
  deduplicarTurnos,
  diaColombia,
  diffInventarios,
  inicioDiaColombia,
  limpiarResumen,
  lunesDe,
  PerfilInvalidoError,
  ResumenInvalidoError,
  tituloHallazgos,
  validarPerfil,
  type FilaConsumo,
  type FotoInventario,
} from '../cv';

const fila = (p: Partial<FilaConsumo>): FilaConsumo => ({
  id: 1,
  id_agent: 7,
  session_id: 's1',
  turn_started_at: new Date('2026-10-01T15:00:00.000Z'),
  created_at: new Date('2026-10-01T15:05:00.000Z'),
  input_tokens: 10,
  cache_creation_tokens: 100,
  cache_read_tokens: 1000,
  output_tokens: 50,
  total_tokens: 1160,
  ...p,
});

describe('días en hora de Colombia', () => {
  it('las 3 a. m. UTC todavía son el día anterior en Colombia', () => {
    expect(diaColombia(new Date('2026-10-02T03:00:00.000Z'))).toBe('2026-10-01');
    expect(diaColombia(new Date('2026-10-02T05:00:00.000Z'))).toBe('2026-10-02');
  });
  it('el día empieza a las 5 a. m. UTC', () => {
    expect(inicioDiaColombia('2026-10-02').toISOString()).toBe('2026-10-02T05:00:00.000Z');
  });
  it('lunes de la semana', () => {
    expect(lunesDe('2026-10-02')).toBe('2026-09-28'); // viernes
    expect(lunesDe('2026-09-28')).toBe('2026-09-28'); // lunes
    expect(lunesDe('2026-10-04')).toBe('2026-09-28'); // domingo
  });
});

describe('consumo deduplicado', () => {
  it('un turno reportado en dos conversaciones cuenta una sola vez', () => {
    const filas = [fila({ id: 1 }), fila({ id: 2 })];
    expect(deduplicarTurnos(filas)).toHaveLength(1);
    const c = consumoPorDia(filas).get('7|2026-10-01');
    expect(c?.turns).toBe(1);
    expect(c?.total_tokens).toBe(1160);
  });
  it('sin session_id cada fila cuenta sola', () => {
    const filas = [fila({ id: 1, session_id: null }), fila({ id: 2, session_id: null })];
    expect(consumoPorDia(filas).get('7|2026-10-01')?.turns).toBe(2);
  });
  it('turnos distintos de la misma sesión se suman', () => {
    const filas = [
      fila({ id: 1 }),
      fila({ id: 2, turn_started_at: new Date('2026-10-01T16:00:00.000Z') }),
    ];
    expect(consumoPorDia(filas).get('7|2026-10-01')?.total_tokens).toBe(2320);
  });
  it('si los reportes del mismo turno no coinciden, se queda el mayor', () => {
    const filas = [fila({ id: 1, total_tokens: 100 }), fila({ id: 2, total_tokens: 900 })];
    expect(consumoPorDia(filas).get('7|2026-10-01')?.total_tokens).toBe(900);
  });
  it('el día sale de la hora del turno (Colombia)', () => {
    const f = fila({ turn_started_at: new Date('2026-10-02T02:00:00.000Z') });
    expect([...consumoPorDia([f]).keys()]).toEqual(['7|2026-10-01']);
  });
});

const foto = (p: Partial<FotoInventario> = {}): FotoInventario => ({
  kind: 'claude-code',
  host: 'Mac de Horus',
  model: 'opus',
  execMode: 'sin-aprobacion',
  execRequiresApproval: false,
  tools: { allow: [], deny: [] },
  skills: ['gss-design'],
  channels: [{ type: 'telegram', policy: 'lista-blanca' }],
  mcps: [{ name: 'sapbo-ryan', access: 'lectura', auth: 'ninguna', company: 'Laboratorios Ryan' }],
  ...p,
});

describe('cambios de inventario', () => {
  it('sin cambios no hay nada que contar', () => {
    expect(diffInventarios(foto(), foto())).toEqual([]);
  });
  it('detecta MCP, skills, modelo, ejecución y acceso', () => {
    const c = diffInventarios(
      foto(),
      foto({
        model: 'sonnet',
        execRequiresApproval: true,
        skills: ['gss-design', 'olp-design'],
        mcps: [
          { name: 'sapbo-ryan', access: 'escritura', auth: 'requerida', company: 'Laboratorios Ryan' },
          { name: 'kronos', access: 'lectura', auth: 'requerida', company: null },
        ],
      })
    );
    expect(c).toContain('Cambió el modelo: de opus a sonnet.');
    expect(c).toContain('Cambió la ejecución de comandos: de sin aprobación a con aprobación.');
    expect(c).toContain('MCP nuevos: kronos.');
    expect(c).toContain('sapbo-ryan pasó de lectura a escritura.');
    expect(c).toContain('sapbo-ryan pasó de sin autenticación a con autenticación.');
    expect(c).toContain('Skills nuevos: olp-design.');
  });
  it('no cuenta como cambio un sondeo que no pudo determinar acceso o autenticación', () => {
    const conAuth = foto({ mcps: [{ name: 'higgsfield', access: 'lectura', auth: 'requerida', company: null }] });
    const sinDato = foto({ mcps: [{ name: 'higgsfield', access: 'desconocido', auth: 'desconocida', company: null }] });
    expect(diffInventarios(conAuth, sinDato)).toEqual([]);
    expect(diffInventarios(sinDato, conAuth)).toEqual([]);
  });
  it('resume listas largas', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, '0')}`);
    const c = diffInventarios(foto({ skills: [] }), foto({ skills: muchos }));
    expect(c[0]).toMatch(/y 4 más\.$/);
  });
});

describe('hallazgos agrupados', () => {
  it('cuenta por severidad en orden', () => {
    expect(contarSeveridades(['alto', 'critico', 'critico', 'bajo'])).toBe('2 críticos, 1 alto y 1 bajo');
    expect(tituloHallazgos('abre', ['medio'])).toBe('Se abrió 1 hallazgo (1 medio)');
    expect(tituloHallazgos('cierra', ['alto', 'alto'])).toBe('Se cerraron 2 hallazgos (2 altos)');
  });
});

describe('perfil', () => {
  it('normaliza y valida', () => {
    expect(validarPerfil({ purpose: '  Atiende   tesorería ', ownerName: 'Nicolás', ownerEmail: 'N@GSS.com ' })).toEqual({
      purpose: 'Atiende tesorería',
      ownerName: 'Nicolás',
      ownerEmail: 'n@gss.com',
    });
    expect(validarPerfil({ purpose: '' })).toEqual({ purpose: null, ownerName: null, ownerEmail: null });
  });
  it('rechaza correo inválido y textos largos', () => {
    expect(() => validarPerfil({ ownerEmail: 'no-es-correo' })).toThrow(PerfilInvalidoError);
    expect(() => validarPerfil({ purpose: 'x'.repeat(1001) })).toThrow(PerfilInvalidoError);
    expect(() => validarPerfil({ purpose: 3 })).toThrow(PerfilInvalidoError);
  });
  it('describe los cambios', () => {
    expect(cambiosPerfil(null, { purpose: 'a', ownerName: 'Ana', ownerEmail: null })).toEqual([
      'Se actualizó el propósito.',
      'Dueño: Ana.',
    ]);
    expect(
      cambiosPerfil({ purpose: 'a', ownerName: 'Ana', ownerEmail: null }, { purpose: 'a', ownerName: 'Ana', ownerEmail: null })
    ).toEqual([]);
  });
});

describe('resumen semanal', () => {
  it('quita encabezados y negritas', () => {
    expect(limpiarResumen('# Resumen\n**Horus** atendió 30 mensajes de 4 personas durante la semana.')).toBe(
      'Resumen\nHorus atendió 30 mensajes de 4 personas durante la semana.'
    );
  });
  it('rechaza vacío o demasiado largo', () => {
    expect(() => limpiarResumen('corto')).toThrow(ResumenInvalidoError);
    expect(() => limpiarResumen('x'.repeat(3000))).toThrow(ResumenInvalidoError);
    expect(() => limpiarResumen(null)).toThrow(ResumenInvalidoError);
  });
});
