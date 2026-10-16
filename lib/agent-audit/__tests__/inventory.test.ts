import { describe, expect, it } from 'vitest';
import {
  InventoryValidationError,
  evaluarHallazgos,
  limpiarDestino,
  ocultarSecretos,
  parseInventoryPayload,
} from '../inventory';

const base = {
  collector: { host: 'Mac de Horus' },
  agents: [
    {
      code: 'horus',
      kind: 'claude-code',
      host: 'Mac de Horus',
      serviceStatus: 'activo',
      execMode: 'sin-aprobacion',
      execRequiresApproval: false,
      skills: ['gss-design', 'gss-design', 'auditoria-agentes-ia'],
      channels: [{ type: 'telegram', policy: 'lista-blanca', allowed: 1 }],
      mcps: [
        {
          name: 'sapbo-abamia',
          transport: 'http',
          target: 'http://192.168.10.5:3022/mcp',
          company: 'Abamia',
          access: 'escritura',
          auth: 'ninguna',
          writeTools: ['sap_create'],
        },
        {
          name: 'sapbo-ryan',
          transport: 'http',
          target: 'http://192.168.10.5:3013/mcp',
          company: 'Laboratorios Ryan',
          access: 'lectura',
          auth: 'ninguna',
        },
        {
          name: 'kronos-synerlink',
          transport: 'http',
          target: 'http://192.168.10.5:3020/mcp',
          access: 'escritura',
          auth: 'requerida',
        },
      ],
    },
  ],
};

describe('ocultarSecretos', () => {
  it('oculta credenciales conocidas', () => {
    expect(ocultarSecretos('Authorization: Bearer abc.def')).not.toContain('abc.def');
    expect(ocultarSecretos('sk-ant-oat01-AAAAAAAAAAAAAAAA')).toBe('<oculto>');
    expect(ocultarSecretos('ghp_abcdefghijklmnopqrstuvwxyz')).toBe('<oculto>');
    expect(ocultarSecretos('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe('<oculto>');
    expect(ocultarSecretos('https://u:clave@host/x?token=123&a=1')).toBe(
      'https://host/x?token=<oculto>&a=1'
    );
    expect(ocultarSecretos('a'.repeat(20) + '0123456789abcdef0123456789abcdef')).toContain(
      '<oculto>'
    );
  });

  it('no toca nombres ni rutas normales', () => {
    expect(ocultarSecretos('/Users/horus/synerlink-bridge/lunaris/prod')).toBe(
      '/Users/horus/synerlink-bridge/lunaris/prod'
    );
    expect(ocultarSecretos('mcp__sapbo-onelatampharma__sap_query_view')).toBe(
      'mcp__sapbo-onelatampharma__sap_query_view'
    );
    expect(ocultarSecretos('informe-estadisticas-empresa')).toBe('informe-estadisticas-empresa');
  });
});

describe('limpiarDestino', () => {
  it('quita consulta, fragmento y credenciales', () => {
    expect(limpiarDestino('http://h:3020/mcp?key=SECRETO#x')).toBe('http://h:3020/mcp');
    expect(limpiarDestino('http://user:pass@h:1/mcp')).toBe('http://h:1/mcp');
    expect(limpiarDestino('')).toBeNull();
  });
});

describe('parseInventoryPayload', () => {
  it('normaliza y deduplica', () => {
    const p = parseInventoryPayload(base);
    expect(p.agents).toHaveLength(1);
    expect(p.agents[0].skills).toEqual(['gss-design', 'auditoria-agentes-ia']);
    expect(p.agents[0].mcps[0].company).toBe('Abamia');
    expect(p.scanRequestId).toBeNull();
  });

  it('valores desconocidos caen en el valor por defecto', () => {
    const p = parseInventoryPayload({
      agents: [
        {
          code: 'x',
          host: 'h',
          kind: 'raro',
          mcps: [{ name: 'm', access: 'todo', auth: 'quizas' }],
        },
      ],
    });
    expect(p.agents[0].kind).toBe('claude-code');
    expect(p.agents[0].mcps[0].access).toBe('desconocido');
    expect(p.agents[0].mcps[0].auth).toBe('desconocida');
  });

  it('rechaza lo que no es un inventario', () => {
    expect(() => parseInventoryPayload(null)).toThrow(InventoryValidationError);
    expect(() => parseInventoryPayload({})).toThrow(InventoryValidationError);
    expect(() => parseInventoryPayload({ agents: [{ code: 'mal código', host: 'h' }] })).toThrow(
      InventoryValidationError
    );
    expect(() =>
      parseInventoryPayload({
        agents: Array.from({ length: 201 }, (_, i) => ({
          code: `a${i}`,
          host: 'h',
        })),
      })
    ).toThrow(InventoryValidationError);
  });

  it('un agente repetido se queda una sola vez', () => {
    const p = parseInventoryPayload({
      agents: [
        { code: 'a', host: 'h1' },
        { code: 'A', host: 'h2' },
      ],
    });
    expect(p.agents).toHaveLength(1);
    expect(p.agents[0].host).toBe('h1');
  });

  it('no deja pasar un token aunque venga en cualquier campo', () => {
    const p = parseInventoryPayload({
      agents: [
        {
          code: 'a',
          host: 'h',
          model: 'Bearer sk-ant-XXXXXXXXXXXX',
          mcps: [{ name: 'm', target: 'http://h/mcp?token=abc' }],
        },
      ],
    });
    expect(JSON.stringify(p)).not.toMatch(/sk-ant|abc/);
  });
});

describe('evaluarHallazgos', () => {
  it('saca las reglas esperadas', () => {
    const [a] = parseInventoryPayload(base).agents;
    const h = evaluarHallazgos(a);
    const codigos = h.map((x) => `${x.ruleCode}:${x.subject}`).sort();
    expect(codigos).toEqual([
      'exec-sin-aprobacion:',
      'mcp-escritura-sin-auth:sapbo-abamia',
      'mcp-escritura:kronos-synerlink',
      'mcp-sin-auth:sapbo-ryan',
    ]);
    expect(h.find((x) => x.ruleCode === 'mcp-escritura-sin-auth')?.severity).toBe('critico');
  });

  it('canal abierto y escaneo fallido', () => {
    const [ok] = parseInventoryPayload({
      agents: [
        {
          code: 'a',
          host: 'h',
          channels: [{ type: 'Telegram', policy: 'abierta' }],
        },
      ],
    }).agents;
    expect(evaluarHallazgos(ok).map((x) => x.ruleCode)).toEqual(['canal-abierto']);
    const [mal] = parseInventoryPayload({
      agents: [
        {
          code: 'a',
          host: 'h',
          error: 'sin conexión',
          execRequiresApproval: false,
        },
      ],
    }).agents;
    expect(evaluarHallazgos(mal).map((x) => x.ruleCode)).toEqual(['escaneo-incompleto']);
  });
});
