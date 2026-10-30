import { describe, expect, it } from 'vitest';
import { flowStepKind } from '../flowStepKind';

describe('flowStepKind', () => {
  it('reconoce el trabajo por el nombre de la tarea (sin importar tildes ni mayúsculas)', () => {
    expect(flowStepKind('Carga de documentos')).toBe('upload');
    expect(flowStepKind('Revisión jurídica')).toBe('review');
    expect(flowStepKind('Aprobación gerencia')).toBe('approve');
    expect(flowStepKind('Pago a proveedor')).toBe('payment');
    expect(flowStepKind('Cotización')).toBe('purchase');
    expect(flowStepKind('Envío de correo al cliente')).toBe('send');
    expect(flowStepKind('Entrega de equipos')).toBe('delivery');
    expect(flowStepKind('Capacitación')).toBe('training');
    expect(flowStepKind('Registro en SAP')).toBe('register');
    expect(flowStepKind('Cierre de contrato')).toBe('close');
    expect(flowStepKind('Contrato marco')).toBe('document');
  });

  it('usa un ícono genérico si el nombre no dice nada conocido', () => {
    expect(flowStepKind('Paso especial')).toBe('task');
    expect(flowStepKind(null)).toBe('task');
  });
});
