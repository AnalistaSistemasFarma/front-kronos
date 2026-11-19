import { describe, expect, it } from 'vitest';
import { formatRequestDate, requestStatusColor, requestStatusIcon, taskVisual } from '../../../components/request-general/list/RequestRowParts';

describe('RequestRowParts (shared by the assigned inbox and Solicitudes generales)', () => {
  it('status colours are the inbox ones for every list', () => {
    expect(requestStatusColor('Abierto')).toBe('blue');
    expect(requestStatusColor('Resuelto')).toBe('green');
    expect(requestStatusColor('Cancelado')).toBe('red');
    expect(requestStatusColor('Devuelta')).toBe('orange');
    expect(requestStatusColor('Por Autorizar')).toBe('gray');
    expect(requestStatusIcon('Sin Empezar')).toBe(requestStatusIcon('otro'));
    expect(taskVisual('abierto').color).toBe('orange');
  });
  it('formats the DB wall-clock date (Bogotá stored in UTC fields)', () => {
    expect(formatRequestDate('2026-09-03T07:13:00.000Z')).toMatch(/de septiembre de 2026/);
    expect(formatRequestDate(null)).toBe('Sin fecha');
    expect(formatRequestDate('x')).toBe('Fecha inválida');
  });
});
