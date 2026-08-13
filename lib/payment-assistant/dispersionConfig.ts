import { prisma } from '../prisma';

/**
 * Lectura de la CONFIGURACIÓN DE DISPERSIÓN por empresa del Asistente de Pagos.
 *
 * La cabecera del archivo DISFON necesita datos de la empresa dispersora que no
 * viven en SAP (cuenta dispersora, tipo de cuenta, NIT con dígito de chequeo,
 * tipo de movimiento, ciudad, oficina, tipo de identificación). Esos datos se
 * guardan en la tabla `payment_dispersion_config` (una fila por id_company),
 * creada por `prisma/seeds/payment-dispersion-config.sql`.
 *
 * La tabla NO está en el schema de Prisma (se administra por seed SQL), por eso
 * se lee con `prisma.$queryRaw`. SOLO LECTURA.
 */

/** Configuración de dispersión de una empresa, ya tipada. */
export interface DispersionConfig {
  idCompany: number;
  /** Número de cuenta dispersora del banco. */
  cuentaDispersora: string;
  /** Tipo de cuenta dispersora: 1 corriente / 2 ahorros / 5 rotativo. */
  tipoCuenta: string;
  /** NIT de la empresa dispersora (con dígito de chequeo). */
  nit: string;
  /** Tipo de movimiento: 002 proveedores (default). */
  tipoMovimiento: string;
  /** Código de ciudad (4 dígitos). */
  codigoCiudad: string;
  /** Código de oficina (3 dígitos). */
  codigoOficina: string;
  /** Tipo de identificación de la empresa: N NIT / L cédula / I extranjero. */
  tipoId: string;
  /** Nombre de la empresa dispersora (puede ser null). */
  nombreEmpresa: string | null;
}

/** Fila cruda tal como la devuelve el $queryRaw (nombres de columna de la BD). */
interface RawDispersionRow {
  id_company: number;
  cuenta_dispersora: string;
  tipo_cuenta: string;
  nit: string;
  tipo_movimiento: string;
  codigo_ciudad: string;
  codigo_oficina: string;
  tipo_id: string;
  nombre_empresa: string | null;
}

/**
 * Lee la configuración de dispersión de una empresa por `id_company`. Devuelve
 * `null` si la empresa no está configurada (no hay fila) o si la tabla aún no
 * existe en la base (el módulo no rompe: el llamador lo reporta como warning).
 */
export async function getDispersionConfig(
  idCompany: number
): Promise<DispersionConfig | null> {
  let rows: RawDispersionRow[] = [];
  try {
    rows = await prisma.$queryRaw<RawDispersionRow[]>`
      SELECT TOP 1
        id_company, cuenta_dispersora, tipo_cuenta, nit, tipo_movimiento,
        codigo_ciudad, codigo_oficina, tipo_id, nombre_empresa
      FROM [dbo].[payment_dispersion_config]
      WHERE id_company = ${idCompany}
    `;
  } catch {
    // La tabla puede no existir todavía (seed no aplicado). No rompemos: se
    // trata como "no configurada" para que el llamador lo reporte.
    return null;
  }

  const r = rows[0];
  if (!r) return null;

  return {
    idCompany: r.id_company,
    cuentaDispersora: r.cuenta_dispersora ?? '',
    tipoCuenta: r.tipo_cuenta ?? '',
    nit: r.nit ?? '',
    tipoMovimiento: r.tipo_movimiento ?? '002',
    codigoCiudad: r.codigo_ciudad ?? '0000',
    codigoOficina: r.codigo_oficina ?? '000',
    tipoId: r.tipo_id ?? 'N',
    nombreEmpresa: r.nombre_empresa ?? null,
  };
}
