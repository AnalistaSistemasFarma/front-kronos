import { describe, it, expect } from 'vitest';
import {
  LINE_LEN,
  num,
  money,
  alphaLeft,
  blanks,
  buildHeader,
  buildDetail,
  buildFile,
  type Empresa,
  type Pago,
} from '../disfon';

// Pruebas del generador del archivo plano DISFON (Banco de Bogotá). El layout
// es de ANCHO FIJO: cada registro DEBE medir exactamente 250 caracteres. Se
// verifican los campos clave por POSICIÓN (slice, 0-indexado) contra las
// columnas del layout del banco.
//
// DATOS SINTÉTICOS: los NIT, cuentas, identificaciones y nombres de abajo son
// inventados. NO son datos reales de beneficiarios ni del banco.

// Empresa dispersora de ejemplo (sintética).
const empresa: Empresa = {
  fechaAplicacion: '20260813',
  tipoCuenta: '1',
  numeroCuenta: '12345678901',
  nombre: 'EMPRESA DEMO SAS',
  nit: '9001234561',
};

// Pago de ejemplo (sintético).
const pago: Pago = {
  tipoId: 'C',
  numeroId: '80012345',
  nombre: 'BENEFICIARIO DE PRUEBA',
  tipoCuenta: '2',
  numeroCuenta: '9876543210',
  valorCents: 4724000,
};

describe('helpers de formato', () => {
  it('num: numérico a la derecha con ceros a la izquierda', () => {
    expect(num('7', 5)).toBe('00007');
    expect(num(123, 3)).toBe('123');
  });

  it('num: lanza error si el valor no cabe en el ancho', () => {
    expect(() => num('123456', 5)).toThrow();
  });

  it('money: centavos en 18 caracteres 9(16)V99', () => {
    expect(money(4724000)).toBe('000000000004724000');
    expect(money(4724000).length).toBe(18);
    expect(money(0)).toBe('000000000000000000');
  });

  it('alphaLeft: alfabético a la izquierda, espacios a la derecha, truncado', () => {
    expect(alphaLeft('AB', 5)).toBe('AB   ');
    expect(alphaLeft('ABCDEF', 3)).toBe('ABC');
    expect(alphaLeft(null, 3)).toBe('   ');
  });

  it('blanks: n espacios', () => {
    expect(blanks(4)).toBe('    ');
  });
});

describe('buildHeader — Registro 1 (cabecera)', () => {
  it('mide exactamente 250 caracteres', () => {
    expect(buildHeader(empresa, 3).length).toBe(LINE_LEN);
  });

  it('tipo de registro = "1" en col 1', () => {
    const h = buildHeader(empresa, 3);
    expect(h.slice(0, 1)).toBe('1');
  });

  it('fecha de aplicación AAAAMMDD en col 2-9', () => {
    const h = buildHeader(empresa, 3);
    expect(h.slice(1, 9)).toBe('20260813');
  });

  it('zona de control (col 10-33) = num(detalles,5)+num(detalles+1,11)+"00000000"', () => {
    const detalles = 3;
    const h = buildHeader(empresa, detalles);
    const zona = h.slice(9, 33);
    expect(zona).toBe(
      num(detalles, 5) + num(detalles + 1, 11) + '00000000',
    );
    expect(zona).toBe('00003' + '00000000004' + '00000000');
    expect(zona.length).toBe(24);
  });

  it('NIT con ceros a la izquierda en col 92-102', () => {
    const h = buildHeader(empresa, 3);
    expect(h.slice(91, 102)).toBe('09001234561');
  });

  it('nombre de empresa alineado a la izquierda con espacios en col 52-91', () => {
    const h = buildHeader(empresa, 3);
    const nombre = h.slice(51, 91);
    expect(nombre).toBe('EMPRESA DEMO SAS'.padEnd(40, ' '));
    expect(nombre.length).toBe(40);
  });

  it('aplica defaults: tipo movimiento "002", ciudad "0000", oficina "000", tipo id "N"', () => {
    const h = buildHeader(empresa, 3);
    expect(h.slice(102, 105)).toBe('002'); // tipo movimiento
    expect(h.slice(105, 109)).toBe('0000'); // ciudad
    expect(h.slice(117, 120)).toBe('000'); // oficina
    expect(h.slice(120, 121)).toBe('N'); // tipo id empresa
  });

  it('fecha de elaboración cae en fecha de aplicación cuando no se especifica', () => {
    const h = buildHeader(empresa, 3);
    expect(h.slice(109, 117)).toBe('20260813');
  });
});

describe('buildDetail — Registro 2 (detalle)', () => {
  it('mide exactamente 250 caracteres', () => {
    expect(buildDetail(pago).length).toBe(LINE_LEN);
  });

  it('tipo de registro = "2" en col 1', () => {
    expect(buildDetail(pago).slice(0, 1)).toBe('2');
  });

  it('tipo de identificación del beneficiario en col 2', () => {
    expect(buildDetail(pago).slice(1, 2)).toBe('C');
  });

  it('cuenta del beneficiario X(17) alineada a la IZQUIERDA en col 56-72', () => {
    const d = buildDetail(pago);
    const cuenta = d.slice(55, 72);
    expect(cuenta).toBe('9876543210'.padEnd(17, ' '));
    expect(cuenta.length).toBe(17);
  });

  it('valor 9(16)V99 en col 73-90 (money)', () => {
    const d = buildDetail(pago);
    expect(d.slice(72, 90)).toBe('000000000004724000');
  });

  it('forma de pago = "A" en col 91', () => {
    expect(buildDetail(pago).slice(90, 91)).toBe('A');
  });

  it('aplica defaults: banco "000", ciudad "0000", factura "0", indicadores "N"', () => {
    const d = buildDetail(pago);
    expect(d.slice(94, 97)).toBe('000'); // código banco
    expect(d.slice(97, 101)).toBe('0000'); // ciudad
    expect(d.slice(182, 192)).toBe('0000000000'); // nº factura -> num("0",10)
    expect(d.slice(192, 193)).toBe('N'); // notificación por correo
    expect(d.slice(241, 242)).toBe('N'); // info complementaria
  });
});

describe('buildFile — cabecera + detalles', () => {
  it('con 2 pagos produce 3 líneas de 250 y termina en "\\n"', () => {
    const pagos: Pago[] = [pago, { ...pago, nombre: 'OTRO BENEFICIARIO', valorCents: 100 }];
    const file = buildFile(empresa, pagos);

    expect(file.endsWith('\n')).toBe(true);

    // Al terminar en "\n", split deja una cadena vacía al final: 3 líneas + "".
    const parts = file.split('\n');
    expect(parts[parts.length - 1]).toBe('');
    const lines = parts.slice(0, -1);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.length).toBe(LINE_LEN);
    }

    // La cabecera refleja el número de detalles (2) en la zona de control.
    expect(lines[0].slice(0, 1)).toBe('1');
    expect(lines[0].slice(9, 33)).toBe(num(2, 5) + num(3, 11) + '00000000');
    expect(lines[1].slice(0, 1)).toBe('2');
    expect(lines[2].slice(0, 1)).toBe('2');
  });
});
