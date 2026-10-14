import { describe, expect, it } from 'vitest';
import {
  SGC_GENERATOR_CODED_MESSAGE,
  SGC_GENERATOR_NO_CODE,
  SGC_TEMPLATE_STATE_LABELS,
  SGC_GENERATOR_MAX_FIELDS,
  SGC_GENERATOR_MAX_LENGTH,
  canApproveTemplate,
  canGenerate,
  canProposeTemplate,
  detectTemplateFields,
  fieldKeyOf,
  fillTemplate,
  formatGeneratedAt,
  generatedCode,
  generatedFileName,
  generatorLegend,
  generatorSourceFormat,
  normalizeGeneratorReason,
  normalizeTemplateFields,
  parseGeneratorMode,
  parseTemplateFields,
  templateState,
  templateStateMessage,
  validateGeneratorValues,
  type SgcGeneratorField,
} from '../generator';
import { SgcError } from '../errors';

/**
 * GENERADOR DE DOCUMENTOS desde plantillas aprobadas por Calidad (2026-10-10):
 * reglas puras — permisos, marcas de campos, validación de valores, llenado
 * escapado, estado de la plantilla y textos del registro.
 */

const CARTA = '<p>Bogotá, {{CAMPO:Fecha de la carta|fecha}}</p><p>Señor(a) <strong>{{CAMPO:Destinatario}}</strong></p><p>{{CAMPO:Cuerpo|parrafo}}</p><p>Cordialmente, {{CAMPO:Destinatario}}</p><p>Código {{CODIGO}}</p>';

describe('SGC · Generador · permisos', () => {
  it('[SGC-REQ-172] proponen gestión documental o Calidad; aprueba SOLO Calidad; genera cualquiera con consulta', () => {
    const lectura = { canRead: true, canManage: false, canQuality: false };
    const gestion = { canRead: true, canManage: true, canQuality: false };
    const calidad = { canRead: true, canManage: false, canQuality: true };
    expect([lectura, gestion, calidad].map(canProposeTemplate)).toEqual([false, true, true]);
    expect([lectura, gestion, calidad].map(canApproveTemplate)).toEqual([false, false, true]);
    expect([lectura, gestion, calidad].map(canGenerate)).toEqual([true, true, true]);
    expect(canProposeTemplate(null)).toBe(false);
    expect(canApproveTemplate(undefined)).toBe(false);
    expect(canGenerate(null)).toBe(false);
  });
});

describe('SGC · Generador · campos editables', () => {
  it('[SGC-REQ-171] detecta las marcas {{CAMPO:…}} en orden, sin repetir, con su tipo; ignora los campos de sistema', () => {
    const fields = detectTemplateFields(CARTA);
    expect(fields.map((f) => [f.key, f.label, f.type, f.maxLength, f.required])).toEqual([
      ['fecha_de_la_carta', 'Fecha de la carta', 'fecha', 10, true],
      ['destinatario', 'Destinatario', 'texto', 200, true],
      ['cuerpo', 'Cuerpo', 'parrafo', 2000, true],
    ]);
    expect(detectTemplateFields('<p>{{ campo : Razón &amp; social | NUMERO }} {{CAMPO:x|raro}}</p>').map((f) => [f.key, f.label, f.type])).toEqual([
      ['razon_social', 'Razón & social', 'numero'],
      ['x', 'x', 'texto'],
    ]);
    expect(detectTemplateFields('<p>{{CODIGO}} {{CAMPO:<b>roto</b>}} {{CAMPO:!!!}}</p>')).toEqual([]);
    expect(detectTemplateFields(null as unknown as string)).toEqual([]);
    expect(fieldKeyOf('  Ñandú  Número 2 ')).toBe('nandu_numero_2');
  });

  it('[SGC-REQ-171] la configuración solo ajusta los campos detectados (tipo, obligatorio, largo ≤ tope, ayuda)', () => {
    const detected = detectTemplateFields(CARTA);
    const out = normalizeTemplateFields(detected, [
      { key: 'destinatario', maxLength: 80, help: '  Nombre completo  ' },
      { key: 'cuerpo', required: false, maxLength: '' },
      { key: 'fecha_de_la_carta', type: 'texto', maxLength: null, help: '   ' },
      'basura',
    ]);
    expect(out).toEqual([
      { key: 'fecha_de_la_carta', label: 'Fecha de la carta', type: 'texto', required: true, maxLength: 200, help: null },
      { key: 'destinatario', label: 'Destinatario', type: 'texto', required: true, maxLength: 80, help: 'Nombre completo' },
      { key: 'cuerpo', label: 'Cuerpo', type: 'parrafo', required: false, maxLength: 2000, help: null },
    ]);
    expect(normalizeTemplateFields(detected, undefined)).toEqual(detected);
    expect(() => normalizeTemplateFields([], [])).toThrow(/no tiene campos editables/);
    expect(() => normalizeTemplateFields(detected, [{ key: 'inventado' }])).toThrow(/no existe en el contenido/);
    expect(() => normalizeTemplateFields(detected, [{}])).toThrow(/sin clave/);
    expect(() => normalizeTemplateFields(detected, [{ key: 'cuerpo', type: 'html' }])).toThrow(/Tipo inválido/);
    expect(() => normalizeTemplateFields(detected, [{ key: 'destinatario', maxLength: 201 }])).toThrow(/entre 1 y 200/);
    expect(() => normalizeTemplateFields(detected, [{ key: 'destinatario', maxLength: 0 }])).toThrow(SgcError);
    const many = Array.from({ length: SGC_GENERATOR_MAX_FIELDS + 1 }, (_, i) => ({ ...detected[1], key: `c${i}` }));
    expect(() => normalizeTemplateFields(many, [])).toThrow(/máximo 40/);
  });

  it('[SGC-REQ-173] la configuración guardada se lee sin romperse ante un JSON dañado', () => {
    const f: SgcGeneratorField[] = [{ key: 'a', label: 'A', type: 'texto', required: true, maxLength: 5, help: null }];
    expect(parseTemplateFields(JSON.stringify(f))).toEqual(f);
    expect(parseTemplateFields('{malo')).toEqual([]);
    expect(parseTemplateFields('{"a":1}')).toEqual([]);
    expect(parseTemplateFields(null)).toEqual([]);
  });
});

describe('SGC · Generador · valores y llenado', () => {
  const fields: SgcGeneratorField[] = [
    { key: 'fecha', label: 'Fecha', type: 'fecha', required: true, maxLength: 10, help: null },
    { key: 'nombre', label: 'Nombre', type: 'texto', required: true, maxLength: 20, help: null },
    { key: 'cuerpo', label: 'Cuerpo', type: 'parrafo', required: false, maxLength: 50, help: null },
    { key: 'valor', label: 'Valor', type: 'numero', required: false, maxLength: 30, help: null },
  ];

  it('[SGC-REQ-174] solo se aceptan los campos permitidos, con obligatorio, largo, fecha y número validados', () => {
    expect(validateGeneratorValues(fields, { fecha: '2026-10-10', nombre: '  Ana \t María\u0007 ', cuerpo: ' línea 1\r\nlínea 2 ', valor: 12.5 })).toEqual({ fecha: '2026-10-10', nombre: 'Ana María', cuerpo: 'línea 1\nlínea 2', valor: '12.5' });
    expect(validateGeneratorValues(fields, { fecha: '2026-02-28', nombre: 'X', cuerpo: null })).toEqual({ fecha: '2026-02-28', nombre: 'X', cuerpo: '', valor: '' });
    expect(() => validateGeneratorValues(fields, { fecha: '2026-10-10', nombre: 'X', titulo: 'cambio el título' })).toThrow(/no es un campo editable/);
    expect(() => validateGeneratorValues(fields, { fecha: '2026-10-10' })).toThrow(/Complete el campo «Nombre»/);
    expect(() => validateGeneratorValues(fields, { fecha: '2026-10-10', nombre: 'x'.repeat(21) })).toThrow(/máximo 20/);
    expect(() => validateGeneratorValues(fields, { fecha: '2026-02-30', nombre: 'X' })).toThrow(/fecha válida/);
    expect(() => validateGeneratorValues(fields, { fecha: '10/10/2026', nombre: 'X' })).toThrow(/fecha válida/);
    expect(() => validateGeneratorValues(fields, { fecha: '2026-10-10', nombre: 'X', valor: '1e5' })).toThrow(/número/);
    expect(() => validateGeneratorValues(fields, { fecha: '2026-10-10', nombre: { html: '<b>' } })).toThrow(/Valor inválido/);
    expect(() => validateGeneratorValues(fields, null)).toThrow(/Envíe los valores/);
    expect(() => validateGeneratorValues(fields, ['x'])).toThrow(/Envíe los valores/);
  });

  it('[SGC-REQ-174] el llenado escapa los valores y deja el resto del contenido IGUAL al aprobado', () => {
    const detected = detectTemplateFields(CARTA);
    const html = fillTemplate(CARTA, detected, { fecha_de_la_carta: '2026-10-10', destinatario: '<script>alert(1)</script> & Cía', cuerpo: 'Uno\nDos' });
    expect(html).toBe(
      '<p>Bogotá, 2026-10-10</p><p>Señor(a) <strong>&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cía</strong></p><p>Uno<br>Dos</p><p>Cordialmente, &lt;script&gt;alert(1)&lt;/script&gt; &amp; Cía</p><p>Código {{CODIGO}}</p>'
    );
    // Una marca que no es un campo de la versión aprobada queda tal cual; un campo sin valor queda vacío.
    expect(fillTemplate('<p>{{CAMPO:Otro}} {{CAMPO:Destinatario}}</p>', detected, {})).toBe('<p>{{CAMPO:Otro}} </p>');
    expect(fillTemplate(null as unknown as string, detected, {})).toBe('');
  });
});

describe('SGC · Generador · estado de la plantilla y registro', () => {
  const ok = { templateStatus: 'activa', approvedVersion: { idDocumentVersion: 7 }, documentStatus: 'vigente', documentCurrentVersionId: 7 };

  it('[SGC-REQ-173] solo se genera desde una plantilla activa, aprobada y al día con su documento vigente', () => {
    expect(templateState(ok)).toBe('disponible');
    expect(templateState({ ...ok, templateStatus: 'retirada' })).toBe('retirada');
    expect(templateState({ ...ok, approvedVersion: null })).toBe('sin_aprobar');
    expect(templateState({ ...ok, documentStatus: 'obsoleto' })).toBe('documento_no_vigente');
    expect(templateState({ ...ok, documentCurrentVersionId: 8 })).toBe('desactualizada');
    expect(templateState({ ...ok, guideType: true })).toBe('disponible');
    expect(templateStateMessage('disponible')).toBe('');
    for (const s of ['retirada', 'sin_aprobar', 'documento_no_vigente', 'desactualizada'] as const) expect(templateStateMessage(s)).not.toBe('');
  });

  it('[SGC-REQ-175] código consecutivo del registro, nombre del archivo y leyenda de trazabilidad', () => {
    expect(generatedCode(12, 1)).toBe('GEN-012-0001');
    expect(generatedCode(1234, 12345)).toBe('GEN-1234-12345');
    expect(() => generatedCode(1, 0)).toThrow();
    expect(() => generatedCode(0, 1)).toThrow();
    expect(generatedFileName('A/B:C-G0001')).toBe('A-B-C-G0001.pdf');
    expect(formatGeneratedAt(new Date('2026-10-10T15:04:00Z'))).toBe('2026-10-10 10:04');
    const base = { documentCode: 'OLP-GC-PLT-001', documentVersion: 2, templateVersion: 3, approvedBy: 'María Camila', approvedAt: new Date('2026-10-09T15:00:00Z'), user: 'Ana', at: new Date('2026-10-10T15:04:00Z') };
    expect(generatorLegend({ ...base, recordCode: 'OLP-GC-PLT-001-G0001' })).toBe('Registro OLP-GC-PLT-001-G0001 · generado por Ana el 2026-10-10 10:04 · plantilla OLP-GC-PLT-001 V2 (configuración v3, aprobada por Calidad: María Camila, 2026-10-09)');
    expect(generatorLegend({ ...base, recordCode: null })).toMatch(/^VISTA PREVIA - sin validez, no se registró · /);
  });

  it('[SGC-REQ-171][SGC-REQ-172] motivo obligatorio, modo de generación y formato del contenido de origen (Word o editor)', () => {
    expect(normalizeGeneratorReason('  Carta de certificación laboral  ')).toBe('Carta de certificación laboral');
    expect(normalizeGeneratorReason('x'.repeat(1200))).toHaveLength(1000);
    expect(() => normalizeGeneratorReason('corto')).toThrow(/mínimo 10/);
    expect(() => normalizeGeneratorReason(5, 'el retiro')).toThrow(/Explique el retiro/);
    expect(parseGeneratorMode('vista')).toBe('vista');
    expect(parseGeneratorMode('emitir')).toBe('emitir');
    expect(parseGeneratorMode('descarga')).toBeNull();
    expect(parseGeneratorMode(1)).toBeNull();
    expect([generatorSourceFormat('Carta V2.DOCX'), generatorSourceFormat('borrador.html'), generatorSourceFormat('x.htm'), generatorSourceFormat('x.pdf'), generatorSourceFormat(null)]).toEqual(['docx', 'html', 'html', null, null]);
    expect(SGC_GENERATOR_MAX_LENGTH.fecha).toBe(10);
  });
});

describe('SGC · Generador · S19 (R34): solo documentos sin codificación', () => {
  const ok = { templateStatus: 'activa', approvedVersion: { idDocumentVersion: 7 }, documentStatus: 'vigente', documentCurrentVersionId: 7 };

  it('[SGC-REQ-179] una plantilla cuyo origen es de un tipo codificado (no «plantilla guía») no genera; retirada sigue mandando', () => {
    expect(templateState({ ...ok, guideType: false })).toBe('tipo_no_guia');
    expect(templateState({ ...ok, guideType: false, templateStatus: 'retirada' })).toBe('retirada');
    expect(templateStateMessage('tipo_no_guia')).toBe(SGC_GENERATOR_CODED_MESSAGE);
    expect(SGC_GENERATOR_CODED_MESSAGE).toMatch(/sin codificación/);
    expect(SGC_GENERATOR_CODED_MESSAGE).toMatch(/por solicitud/);
    expect(SGC_TEMPLATE_STATE_LABELS.tipo_no_guia).toMatch(/codificado/);
  });

  it('[SGC-REQ-179] el registro generado no lleva el código documental del origen', () => {
    expect(SGC_GENERATOR_NO_CODE).toBe('Sin codificación');
    const code = generatedCode(3, 7);
    expect(code).toBe('GEN-003-0007');
    expect(code).not.toMatch(/PLT|FO|-G\d/);
  });
});
