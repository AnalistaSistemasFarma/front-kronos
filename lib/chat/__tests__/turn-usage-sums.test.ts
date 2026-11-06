import { describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../../prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));

import { aNumero, consultaConsumoTurnos, consumoTurnosPor } from '../turn-usage-sums';

/** Texto de la consulta con espacios normalizados, para comparar sin depender de la sangría. */
const texto = (q: { sql: string }) => q.sql.replace(/\s+/g, ' ');

describe('consultaConsumoTurnos', () => {
  it('suma cada columna de tokens como BIGINT (evita el desborde P2020 del INT)', () => {
    const q = consultaConsumoTurnos('id_agent', { alcance: { all: true } });
    for (const col of ['total_tokens', 'input_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'output_tokens', 'thinking_tokens']) {
      expect(texto(q)).toContain(`SUM(CAST(u.${col} AS BIGINT))`);
    }
    expect(texto(q)).toContain('GROUP BY u.id_agent');
    expect(texto(q)).not.toContain('WHERE');
    expect(q.values).toEqual([]);
  });

  it('parametriza fechas, agente, conversación y empresa (nada va pegado al SQL)', () => {
    const desde = new Date('2026-10-01T00:00:00Z');
    const hasta = new Date('2026-10-21T23:59:59Z');
    const q = consultaConsumoTurnos('id_conversation', {
      desde,
      hasta,
      idAgent: 7,
      idConversation: 99,
      idCompany: 3,
      alcance: { all: true },
    });
    expect(texto(q)).toContain('GROUP BY u.id_conversation');
    expect(texto(q)).toContain('u.created_at >= ? AND u.created_at <= ? AND u.id_agent = ? AND u.id_conversation = ?');
    expect(texto(q)).toContain('[agent_company]');
    expect(q.values).toEqual([desde, hasta, 7, 99, 3, 3]);
  });

  it('aplica el alcance de auditoría; una lista vacía no deja ver nada', () => {
    const q = consultaConsumoTurnos('id_agent', { alcance: { all: false, agentIds: [1, 2], companyIds: [] } });
    expect(texto(q)).toContain("c.kind = 'direct' AND c.id_agent IN (?,?)");
    expect(texto(q)).toContain("c.kind = 'group' AND 1 = 0");
    expect(q.values).toEqual([1, 2]);
  });
});

describe('consumoTurnosPor', () => {
  it('convierte los BIGINT del driver a number serializable en JSON', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        clave: 1,
        turnos: BigInt(1619),
        total_tokens: BigInt('4029081761'),
        input_tokens: BigInt(10),
        cache_creation_tokens: null,
        cache_read_tokens: BigInt('3926405162'),
        output_tokens: 5,
        thinking_tokens: '2',
      },
    ]);
    const filas = await consumoTurnosPor('id_agent', { alcance: { all: true } });
    expect(filas).toEqual([
      {
        clave: 1,
        turnos: 1619,
        totalTokens: 4029081761,
        inputTokens: 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 3926405162,
        outputTokens: 5,
        thinkingTokens: 2,
      },
    ]);
    expect(() => JSON.stringify(filas)).not.toThrow();
  });

  it('aNumero tolera null, undefined y texto no numérico', () => {
    expect(aNumero(null)).toBe(0);
    expect(aNumero(undefined)).toBe(0);
    expect(aNumero('x')).toBe(0);
    expect(aNumero(BigInt(3))).toBe(3);
  });
});
