import { describe, it, expect } from 'vitest';
import {
  buildSummaryInput,
  buildSummaryPrompt,
  SUMMARY_SYSTEM_PROMPT,
} from '../summaryInput';

// Pruebas del helper PURO que arma el texto a resumir con la IA local.
// No toca DOM ni navegador: solo verifica el armado de secciones y el
// descarte de campos vacíos.

describe('buildSummaryInput', () => {
  it('arma asunto + descripción + notas + tareas en secciones', () => {
    const out = buildSummaryInput(
      { subject: 'Pago a proveedor', description: 'Se requiere autorizar el pago.' },
      [{ note: 'Falta soporte', createdBy: 'Ana' }],
      [{ task: 'Revisar', description: 'Validar factura', status: 'Pendiente' }],
    );
    expect(out).toContain('Asunto: Pago a proveedor');
    expect(out).toContain('Descripción:\nSe requiere autorizar el pago.');
    expect(out).toContain('- (Ana) Falta soporte');
    expect(out).toContain('- Revisar — Validar factura [Pendiente]');
  });

  it('omite los campos vacíos sin dejar secciones huérfanas', () => {
    const out = buildSummaryInput(
      { subject: '  ', description: 'Solo descripción' },
      [{ note: '   ', createdBy: 'X' }],
      [],
    );
    expect(out).not.toContain('Asunto:');
    expect(out).not.toContain('Historial de interacciones');
    expect(out).toContain('Descripción:\nSolo descripción');
  });

  it('devuelve cadena vacía cuando no hay nada aprovechable', () => {
    expect(buildSummaryInput(null, [], [])).toBe('');
    expect(buildSummaryInput(undefined)).toBe('');
    expect(buildSummaryInput({ subject: '', description: null })).toBe('');
  });

  it('nota sin autor se muestra sin paréntesis', () => {
    const out = buildSummaryInput({ subject: 'A' }, [{ note: 'sin autor' }], []);
    expect(out).toContain('- sin autor');
    expect(out).not.toContain('()');
  });
});

describe('buildSummaryPrompt', () => {
  it('antepone la instrucción humana al texto de la solicitud', () => {
    const out = buildSummaryPrompt('Asunto: Pago');
    expect(out).toContain('Resume esta solicitud de forma humana y cercana:');
    expect(out).toContain('Asunto: Pago');
    expect(out.indexOf('humana')).toBeLessThan(out.indexOf('Asunto: Pago'));
  });
});

describe('SUMMARY_SYSTEM_PROMPT', () => {
  it('fija tono cálido/humano en español y prohíbe copiar literal', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('español');
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(/c[aá]lido/i);
    expect(SUMMARY_SYSTEM_PROMPT).toContain('NO copies el texto literal');
  });
});
