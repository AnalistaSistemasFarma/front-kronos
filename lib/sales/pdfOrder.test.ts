import { describe, expect, it } from 'vitest';
import { parsePdfOrder, searchTerms } from './pdfOrder';

describe('PDF de la OC con IA del navegador', () => {
  it('normaliza la respuesta y descarta líneas inválidas', () => {
    const r = parsePdfOrder('Aquí está: {"numeroOrdenCompra":"OC-123","nitCliente":"900.123.456-7","fechaEntrega":"2026-11-20","lineas":[' +
      '{"codigo":"10223","descripcion":"INFUSOR HOMEPUMP","cantidad":10,"precioUnitario":104060},' +
      '{"descripcion":"EPINEFRINA 1MG","cantidad":"1.200","precioUnitario":"2.500,5"},' +
      '{"descripcion":"TOTAL","cantidad":0}]}');
    expect(r.numeroOrdenCompra).toBe('OC-123');
    expect(r.nitCliente).toBe('900123456-7');
    expect(r.lineas).toEqual([
      { row: 1, ItemCode: '10223', Quantity: 10, UnitPrice: 104060, WarehouseCode: '', ItemDescription: 'INFUSOR HOMEPUMP' },
      { row: 2, ItemCode: '', Quantity: 1200, UnitPrice: 2500.5, WarehouseCode: '', ItemDescription: 'EPINEFRINA 1MG' },
    ]);
  });
  it('respuesta ilegible da un error claro', () => {
    expect(() => parsePdfOrder('no sé')).toThrow(/legible/);
  });
  it('palabras de búsqueda de la descripción', () => {
    expect(searchTerms('Epinefrina 1mg/1ml amp caja x 100')).toEqual(['EPINEFRINA']);
    expect(searchTerms('INFUSOR MED HOMEPUMP 270ML')).toEqual(['INFUSOR', 'HOMEPUMP']);
  });
});

import { bestCandidate, nitBase, similarity } from './pdfOrder';
describe('montar la oferta desde el PDF', () => {
  it('NIT base sin dígito de verificación', () => {
    expect(nitBase('900.123.456-7')).toBe('900123456');
    expect(nitBase('1015435914')).toBe('1015435914');
  });
  it('elige el infusor con la medida correcta', () => {
    const c = [
      { ItemCode: '10220', ItemName: 'INFUSOR MED HOMEPUMP 270ML - 10ML/H-1D  CAJA X 6' },
      { ItemCode: '10223', ItemName: 'INFUSOR MED HOMEPUMP 270ML - 5ML/H-2D  CAJA X 6' },
      { ItemCode: '10605', ItemName: 'MINICANGURO PARA INFUSOR HOMEPUMP UNIDAD (4042078)' },
    ];
    const b = bestCandidate('Infusor Homepump 270 ml 5ml/h', c);
    expect(b?.ItemCode).toBe('10223');
    expect(similarity('Infusor Homepump 270 ml 5ml/h', c[1].ItemName)).toBeGreaterThan(similarity('Infusor Homepump 270 ml 5ml/h', c[0].ItemName));
  });
  it('la talla cuenta: no cambia talla M por L', () => {
    const c = [
      { ItemCode: 'L', ItemName: 'GUANTES DE NITRILO NO ESTERIL AZUL TALLA - L CAJA X 100' },
      { ItemCode: 'M', ItemName: 'GUANTES DE NITRILO NO ESTERIL AZUL TALLA - M CAJA X 100' },
    ];
    expect(bestCandidate('GUANTES DE NITRILO TALLA M', c)?.ItemCode).toBe('M');
    expect(bestCandidate('GUANTES DE NITRILO TALLA M', [c[0]])).toBeNull();
  });
  it('sin parecido suficiente no elige nada', () => {
    expect(bestCandidate('GUANTES DE NITRILO', [{ ItemCode: '1', ItemName: 'EPINEFRINA 1MG' }])).toBeNull();
  });
});

import { chunkOrderText, mergePdfOrders, tableHeaderRow } from './pdfOrder';
describe('OC larga: por fragmentos (ventana de contexto pequeña)', () => {
  const rows = Array.from({ length: 36 }, (_, i) => `${10000 + i} | ARTICULO ${i} | ${i + 1} | 1000`);
  const pages = [`--- Página 1 ---\nORDEN DE COMPRA 55\nCODIGO | DESCRIPCION | CANTIDAD | PRECIO\n${rows.slice(0, 20).join('\n')}`, `--- Página 2 ---\n${rows.slice(20).join('\n')}`];
  it('parte en fragmentos de renglones completos sin perder ninguno', () => {
    const c = chunkOrderText(pages, 3000, 15);
    expect(c.length).toBeGreaterThan(2);
    const all = c.join('\n');
    rows.forEach((r) => expect(all).toContain(r));
  });
  it('encuentra el renglón de encabezados de la tabla', () => {
    expect(tableHeaderRow(pages)).toBe('CODIGO | DESCRIPCION | CANTIDAD | PRECIO');
  });
  it('une los resultados: cabecera del primero que la traiga y todas las líneas renumeradas', () => {
    const l = (code: string) => ({ row: 1, ItemCode: code, Quantity: 1, UnitPrice: null, WarehouseCode: '', ItemDescription: code });
    const m = mergePdfOrders([
      { numeroOrdenCompra: '', nitCliente: '900', fechaEntrega: '', lineas: [l('A'), l('B')] },
      { numeroOrdenCompra: 'OC-1', nitCliente: '', fechaEntrega: '2026-12-01', lineas: [l('C')] },
    ]);
    expect(m).toMatchObject({ numeroOrdenCompra: 'OC-1', nitCliente: '900', fechaEntrega: '2026-12-01' });
    expect(m.lineas.map((x) => `${x.row}${x.ItemCode}`)).toEqual(['1A', '2B', '3C']);
  });
});

describe('orden de las líneas', () => {
  it('las líneas leídas conservan el renglón del documento al unir fragmentos', () => {
    const l = (code: string) => ({ row: 9, ItemCode: code, Quantity: 1, UnitPrice: null, WarehouseCode: '', ItemDescription: code });
    const m = mergePdfOrders([{ numeroOrdenCompra: '', nitCliente: '', fechaEntrega: '', lineas: [l('A'), l('B')] }, { numeroOrdenCompra: '', nitCliente: '', fechaEntrega: '', lineas: [l('C')] }]);
    expect(m.lineas.map((x) => x.row)).toEqual([1, 2, 3]);
  });
});

import { agentOrderInstruction, agentReplyJson } from './pdfOrder';
describe('montar con agente', () => {
  it('la instrucción pide solo JSON y prohíbe acciones', () => {
    const t = agentOrderInstruction('OLP', 'oc.pdf');
    expect(t).toContain('```json');
    expect(t).toMatch(/No consultes ni modifiques SAP/);
  });
  it('toma el bloque json de la respuesta del agente', () => {
    const body = 'Listo, aquí está:\n```json\n{"numeroOrdenCompra":"OC-7","nitCliente":"900","fechaEntrega":"","lineas":[{"codigo":"A","descripcion":"X","cantidad":2,"precioUnitario":10}]}\n```\nSaludos {no}';
    expect(parsePdfOrder(agentReplyJson(body)).numeroOrdenCompra).toBe('OC-7');
  });
});

import { assembleAgentReply, extractAgentJson, isJsonAttachment, rawLineCount } from './pdfOrder';

/** Same cut as the SynerLink channel reply tool (synerlink-channel/server.ts `chunk`, 40,000 characters). */
function channelChunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const para = rest.lastIndexOf('\n\n', limit);
    const line = rest.lastIndexOf('\n', limit);
    const space = rest.lastIndexOf(' ', limit);
    const cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

/** A big purchase order like FE-4390 (358 lines, ≈ 44 KB of JSON), one line object per text line. */
function bigOrderReply(lines: number, oneLine = false): string {
  const items = Array.from({ length: lines }, (_, i) =>
    JSON.stringify({ codigo: String(10000 + i), descripcion: `PRODUCTO DE PRUEBA ${i + 1} 20MG/1ML AMP CAJA X 100`, cantidad: 100 + i, precioUnitario: 1234.56 + i }));
  const json = `{"numeroOrdenCompra":"OC1","nitCliente":"900149596-3","fechaEntrega":"","lineas":[${oneLine ? '' : '\n'}${items.join(oneLine ? ', ' : ',\n')}${oneLine ? '' : '\n'}]}`;
  return '```json\n' + json + '\n```';
}

describe('respuesta del agente partida en varios mensajes (OC grande)', () => {
  it('une las 2 partes cortadas por el canal y lee las 358 líneas', () => {
    const parts = channelChunk(bigOrderReply(358), 40_000);
    expect(parts).toHaveLength(2);
    expect(parts[0].startsWith('```json')).toBe(true);
    expect(parts[1].trimEnd().endsWith('```')).toBe(true);
    // The first part alone is not enough.
    expect(assembleAgentReply([parts[0]])).toEqual({ status: 'incomplete', parts: 1 });
    const a = assembleAgentReply(parts);
    expect(a.status).toBe('ok');
    if (a.status !== 'ok') return;
    expect(a.parts).toBe(2);
    const r = parsePdfOrder(a.json);
    expect(r.numeroOrdenCompra).toBe('OC1');
    expect(r.nitCliente).toBe('900149596-3');
    expect(r.lineas).toHaveLength(358);
    expect(rawLineCount(a.json)).toBe(358);
    expect(r.lineas[0]).toMatchObject({ row: 1, ItemCode: '10000', Quantity: 100, UnitPrice: 1234.56 });
    expect(r.lineas[357]).toMatchObject({ row: 358, ItemCode: '10357', Quantity: 457 });
  });
  it('tres partes y corte en un espacio dentro de una descripción', () => {
    const parts = channelChunk(bigOrderReply(900, true), 40_000);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const a = assembleAgentReply(parts);
    expect(a.status).toBe('ok');
    if (a.status === 'ok') expect(parsePdfOrder(a.json).lineas).toHaveLength(900);
  });
  it('ignora la charla previa y un comentario posterior al JSON', () => {
    const parts = channelChunk(bigOrderReply(358), 40_000);
    const a = assembleAgentReply(['Con gusto, ya la leo.', ...parts, 'Quedo atento.']);
    expect(a).toMatchObject({ status: 'ok', parts: 2 });
  });
  it('respuesta pequeña en un solo mensaje: igual que antes', () => {
    const body = 'Listo:\n```json\n{"numeroOrdenCompra":"OC-7","nitCliente":"900123456-7","fechaEntrega":"","lineas":[{"codigo":"1","descripcion":"X","cantidad":2,"precioUnitario":10}]}\n```';
    const a = assembleAgentReply([body]);
    expect(a).toMatchObject({ status: 'ok', parts: 1 });
    if (a.status === 'ok') expect(parsePdfOrder(a.json).lineas).toHaveLength(1);
    expect(assembleAgentReply(['{"numeroOrdenCompra":"OC-8","lineas":[]}'])).toMatchObject({ status: 'ok' });
  });
  it('sin JSON todavía: sigue esperando', () => {
    expect(assembleAgentReply([])).toEqual({ status: 'none' });
    expect(assembleAgentReply(['Estoy leyendo el PDF, un momento.'])).toEqual({ status: 'none' });
  });
  it('bloque sin cerrar: toma lo que hay dentro', () => {
    expect(extractAgentJson('```json\n{"a":1}')).toBe('{"a":1}');
    expect(extractAgentJson('texto {"a":{"b":2}} fin')).toBe('{"a":{"b":2}}');
  });
  it('reconoce el JSON adjunto como archivo', () => {
    expect(isJsonAttachment({ fileName: 'oferta.json', contentType: null })).toBe(true);
    expect(isJsonAttachment({ fileName: 'x.bin', contentType: 'application/json; charset=utf-8' })).toBe(true);
    expect(isJsonAttachment({ fileName: 'FE-4390.pdf', contentType: 'application/pdf' })).toBe(false);
  });
});
