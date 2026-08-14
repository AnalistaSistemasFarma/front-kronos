// ---------------------------------------------------------------------------
// Generador del archivo plano DISFON — Banco de Bogotá (dispersión de fondos).
//
// DISFON es un plano ASCII de ANCHO FIJO, 250 caracteres por línea, usado por
// el Banco de Bogotá para la dispersión / pago a beneficiarios:
//
//   - Registro 1 (tipo "1") = cabecera de la empresa dispersora (una sola vez).
//   - Registro 2 (tipo "2") = un renglón por cada pago a un beneficiario.
//
// Esta es la base del futuro módulo "Asistente de pagos". Es una función PURA:
// no hace llamadas a SAP, no toca la red y no agrega dependencias. Solo arma
// texto a partir de los datos de entrada.
//
// El layout se validó carácter por carácter contra el ejemplo del banco. Los
// anchos, posiciones y reglas de relleno de abajo reproducen fielmente ese
// ejemplo real.
//
// NOTA (por confirmar con el banco): la semántica exacta de la "zona de control"
// de la cabecera (columnas 10-33) está pendiente de confirmación oficial. Aquí
// se reproduce el patrón observado en el ejemplo real del banco:
//   num(numDetalles,5) + num(numDetalles+1,11) + num(0,8)
// ---------------------------------------------------------------------------

/** Longitud fija obligatoria de cada registro (línea) DISFON. */
export const LINE_LEN = 250;

/**
 * 9(width): campo numérico, alineado a la DERECHA y rellenado con ceros a la
 * izquierda. Lanza error si el valor no cabe en `width` caracteres.
 */
export function num(value: string | number, width: number): string {
  const s = String(value);
  if (s.length > width) {
    throw new Error(
      `num: el valor "${s}" (${s.length}) excede el ancho ${width}`,
    );
  }
  return s.padStart(width, '0');
}

/**
 * 9(16)V99: valor monetario en CENTAVOS (enteros), representado en 18
 * caracteres (16 enteros + 2 decimales implícitos, sin punto). Los `cents` ya
 * incluyen los dos decimales. Ej.: money(4724000) -> "000000000004724000".
 */
export function money(cents: string | number, intDigits = 16): string {
  const n = Math.trunc(Number(cents));
  if (!Number.isFinite(n)) {
    throw new Error(`money: valor no numérico "${cents}"`);
  }
  return num(n, intDigits + 2);
}

/**
 * X(width): campo alfabético/alfanumérico, alineado a la IZQUIERDA y rellenado
 * con espacios a la derecha. Se trunca a `width` caracteres si es más largo.
 */
export function alphaLeft(value: string | null | undefined, width: number): string {
  return (value || '').slice(0, width).padEnd(width, ' ');
}

/** Devuelve una cadena de `w` espacios en blanco. */
export function blanks(w: number): string {
  return ' '.repeat(w);
}

/** Empresa dispersora (Registro 1 / cabecera). */
export interface Empresa {
  /** Fecha de aplicación AAAAMMDD. */
  fechaAplicacion: string | number;
  /** Tipo de cuenta dispersora: 1 corriente / 2 ahorros / 5 rotativo. */
  tipoCuenta: string | number;
  /** Número de cuenta dispersora. */
  numeroCuenta: string | number;
  /** Nombre de la empresa dispersora. */
  nombre: string;
  /** NIT (con dígito de chequeo). */
  nit: string | number;
  /** Fecha de elaboración AAAAMMDD. Si no se da, se usa `fechaAplicacion`. */
  fechaElaboracion?: string | number;
  /** Tipo de movimiento: 001 nómina / 002 proveedores / 003 otros. Default "002". */
  tipoMovimiento?: string | number;
  /** Código de ciudad. Default "0000". */
  codigoCiudad?: string | number;
  /** Código de oficina. Default "000". */
  codigoOficina?: string | number;
  /** Tipo de identificación de la empresa (N/L/I). Default "N". */
  tipoId?: string;
  /** Indicador de envío de información complementaria. Default " ". */
  enviaComplementaria?: string;
}

/** Beneficiario / pago (Registro 2 / detalle). */
export interface Pago {
  /** Tipo de identificación del beneficiario (C/N/T/E/L/I/P). */
  tipoId: string;
  /** Número de identificación. */
  numeroId: string | number;
  /** Nombre del beneficiario. */
  nombre: string;
  /** Tipo de cuenta del beneficiario: 1 / 2 / 5. */
  tipoCuenta: string | number;
  /** Número de cuenta del beneficiario. X(17), alineado a la IZQUIERDA. */
  numeroCuenta: string;
  /** Valor del pago en CENTAVOS (enteros), 9(16)V99. */
  valorCents: string | number;
  /** Código del banco del beneficiario. Default "000". */
  codigoBanco?: string | number;
  /** Código de ciudad. Default "0000". */
  codigoCiudad?: string | number;
  /** Addenda (información libre). Default "". */
  addenda?: string;
  /** Número de factura / comprobante. Default "0". */
  numeroFactura?: string | number;
  /** Indicador de notificación por correo (C/N). Default "N". */
  notificarCorreo?: string;
  /** Indicador de información complementaria (S/N). Default "N". */
  infoComplementaria?: string;
}

/** Verifica que un registro mida exactamente LINE_LEN; si no, lanza error. */
function ensureLineLen(line: string, registro: string): string {
  if (line.length !== LINE_LEN) {
    throw new Error(
      `${registro}: la línea mide ${line.length}, se esperaban ${LINE_LEN} caracteres`,
    );
  }
  return line;
}

/**
 * Registro 1 (cabecera). Empresa dispersora.
 *
 * Zona de control (col 10-33, 24 car) = num(numDetalles,5) + num(totalReg,11) +
 * num(0,8), donde totalReg = numDetalles + 1 (los detalles + la cabecera).
 */
export function buildHeader(emp: Empresa, numDetalles: number): string {
  const totalReg = numDetalles + 1;
  const zona = num(numDetalles, 5) + num(totalReg, 11) + num(0, 8);
  const fechaElab = emp.fechaElaboracion ?? emp.fechaAplicacion;

  const line =
    num(1, 1) +                                           // col 1     tipo registro = 1
    num(emp.fechaAplicacion, 8) +                         // col 2-9   fecha AAAAMMDD
    zona +                                                // col 10-33 zona de control (24)
    num(emp.tipoCuenta, 1) +                              // col 34    tipo cuenta dispersora
    num(0, 6) +                                           // col 35-40 ceros
    num(emp.numeroCuenta, 11) +                           // col 41-51 nº cuenta dispersora
    alphaLeft(emp.nombre, 40) +                           // col 52-91 nombre empresa
    num(emp.nit, 11) +                                    // col 92-102 NIT (con dígito de chequeo)
    num(emp.tipoMovimiento ?? '002', 3) +                 // col 103-105 tipo movimiento; default "002"
    num(emp.codigoCiudad ?? '0000', 4) +                  // col 106-109 ciudad; default "0000"
    num(fechaElab, 8) +                                   // col 110-117 fecha elaboración AAAAMMDD
    num(emp.codigoOficina ?? '000', 3) +                  // col 118-120 oficina; default "000"
    alphaLeft(emp.tipoId ?? 'N', 1) +                     // col 121 tipo id empresa (N/L/I); default "N"
    blanks(29) +                                          // col 122-150
    blanks(18) +                                          // col 151-168 valor libranza (blancos si no aplica)
    blanks(1) +                                           // col 169
    alphaLeft(emp.enviaComplementaria ?? ' ', 1) +        // col 170 indicador complementaria; default " "
    blanks(80);                                           // col 171-250

  return ensureLineLen(line, 'Registro 1 (cabecera)');
}

/** Registro 2 (beneficiario / pago). */
export function buildDetail(p: Pago): string {
  const line =
    num(2, 1) +                                           // col 1 tipo registro = 2
    alphaLeft(p.tipoId, 1) +                              // col 2 tipo id beneficiario (C/N/T/E/L/I/P)
    num(p.numeroId, 11) +                                 // col 3-13 nº id
    alphaLeft(p.nombre, 40) +                             // col 14-53 nombre
    num(0, 1) +                                           // col 54 cero
    num(p.tipoCuenta, 1) +                                // col 55 tipo cuenta beneficiario (1/2/5)
    alphaLeft(p.numeroCuenta, 17) +                       // col 56-72 nº cuenta X(17) IZQUIERDA con espacios
    money(p.valorCents) +                                 // col 73-90 valor 9(16)V99
    alphaLeft('A', 1) +                                   // col 91 forma de pago = A (abono)
    num(0, 3) +                                           // col 92-94 ceros
    num(p.codigoBanco ?? '000', 3) +                      // col 95-97 código banco beneficiario; default "000"
    num(p.codigoCiudad ?? '0000', 4) +                    // col 98-101 ciudad; default "0000"
    alphaLeft(p.addenda ?? '', 80) +                      // col 102-181 addenda
    num(0, 1) +                                           // col 182 cero
    num(p.numeroFactura ?? '0', 10) +                     // col 183-192 nº factura/comprobante; default "0"
    alphaLeft(p.notificarCorreo ?? 'N', 1) +              // col 193 indicador notificación (C/N); default "N"
    blanks(8) +                                           // col 194-201
    blanks(18) +                                          // col 202-219 cuota libranza (blancos)
    blanks(11) +                                          // col 220-230 nº libranza (blancos)
    blanks(11) +                                          // col 231-241
    alphaLeft(p.infoComplementaria ?? 'N', 1) +           // col 242 indicador info complementaria (S/N); default "N"
    blanks(8);                                            // col 243-250

  return ensureLineLen(line, 'Registro 2 (detalle)');
}

/**
 * Une la cabecera con todos los detalles usando "\n" y termina con un "\n"
 * final. El número de detalles de la cabecera se deriva de `pagos.length`.
 */
export function buildFile(emp: Empresa, pagos: Pago[]): string {
  const lines = [buildHeader(emp, pagos.length), ...pagos.map(buildDetail)];
  return lines.join('\n') + '\n';
}
