import { describe, expect, it } from 'vitest';
import {
  MAX_USER_MESSAGE_CHARS,
  PREVIEW_CHARS,
  isAgentState,
  normalizeMessageBody,
  parseNonNegativeInt,
  parsePositiveInt,
  toPreview,
} from '../constants';

describe('normalizeMessageBody', () => {
  it('recorta el espacio sobrante', () => {
    const r = normalizeMessageBody('  hola  ', MAX_USER_MESSAGE_CHARS);
    expect(r).toEqual({ ok: true, body: 'hola' });
  });

  it('rechaza lo que no es texto', () => {
    for (const v of [undefined, null, 42, {}, []]) {
      expect(normalizeMessageBody(v, 100).ok).toBe(false);
    }
  });

  it('rechaza un mensaje vacío o solo de espacios', () => {
    expect(normalizeMessageBody('', 100).ok).toBe(false);
    expect(normalizeMessageBody('   \n\t ', 100).ok).toBe(false);
  });

  it('rechaza un mensaje que supera el tope y dice cuánto mide', () => {
    const r = normalizeMessageBody('x'.repeat(101), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/101/);
  });

  it('acepta exactamente el tope', () => {
    expect(normalizeMessageBody('x'.repeat(100), 100).ok).toBe(true);
  });

  it('guarda el Markdown tal cual: no escapa ni convierte nada', () => {
    const md = '**negrita** <script>alert(1)</script> `code`';
    const r = normalizeMessageBody(md, 1000);
    expect(r).toEqual({ ok: true, body: md });
  });
});

describe('toPreview', () => {
  it('aplana los saltos de línea', () => {
    expect(toPreview('hola\n\nmundo')).toBe('hola mundo');
  });

  it('recorta al tope con puntos suspensivos', () => {
    const p = toPreview('x'.repeat(500));
    expect(p.length).toBe(PREVIEW_CHARS);
    expect(p.endsWith('…')).toBe(true);
  });
});

describe('isAgentState', () => {
  it('acepta solo los tres estados válidos', () => {
    expect(isAgentState('idle')).toBe(true);
    expect(isAgentState('thinking')).toBe(true);
    expect(isAgentState('tool')).toBe(true);
    expect(isAgentState('IDLE')).toBe(false);
    expect(isAgentState('otro')).toBe(false);
    expect(isAgentState(1)).toBe(false);
    expect(isAgentState(undefined)).toBe(false);
  });
});

describe('parsePositiveInt / parseNonNegativeInt', () => {
  it('aplica el valor por defecto y el tope', () => {
    expect(parsePositiveInt(null, 30, 100)).toBe(30);
    expect(parsePositiveInt('', 30, 100)).toBe(30);
    expect(parsePositiveInt('50', 30, 100)).toBe(50);
    expect(parsePositiveInt('9999', 30, 100)).toBe(100);
    expect(parsePositiveInt('-5', 30, 100)).toBe(30);
    expect(parsePositiveInt('abc', 30, 100)).toBe(30);
  });

  it('los cursores admiten 0 pero no negativos ni basura', () => {
    expect(parseNonNegativeInt('0')).toBe(0);
    expect(parseNonNegativeInt('57')).toBe(57);
    expect(parseNonNegativeInt('-1')).toBeNull();
    expect(parseNonNegativeInt('abc')).toBeNull();
    expect(parseNonNegativeInt(null)).toBeNull();
  });
});
