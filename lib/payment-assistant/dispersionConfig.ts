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
 * se lee con `prisma.$queryRaw` y se escribe con `prisma.$executeRaw`.
 *
 * IMPORTANTE: la ÚNICA escritura permitida del Asistente de Pagos es sobre esta
 * tabla propia en KRONOSDB_PRUEBAS. NUNCA se escribe en SAP.
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
  /**
   * Carpeta del SERVIDOR donde se deja el archivo DISFON generado (ruta local
   * del servidor). El banco lo recoge de ahí por H2H/MFT. Puede ser null si aún
   * no se ha configurado.
   */
  carpetaSalida: string | null;
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
  carpeta_salida: string | null;
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
        codigo_ciudad, codigo_oficina, tipo_id, nombre_empresa, carpeta_salida
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
    carpetaSalida: r.carpeta_salida ?? null,
  };
}

/** Campos editables de la configuración de dispersión (sin id_company). */
export interface DispersionConfigInput {
  cuentaDispersora: string;
  tipoCuenta: string;
  nit: string;
  tipoMovimiento: string;
  codigoCiudad: string;
  codigoOficina: string;
  tipoId: string;
  nombreEmpresa: string | null;
  /** Carpeta del servidor donde se deja el archivo DISFON (puede ser null). */
  carpetaSalida: string | null;
}

/**
 * Inserta o actualiza (UPSERT por `id_company`) la configuración de dispersión
 * de una empresa en `payment_dispersion_config`. Escritura PARAMETRIZADA con
 * `prisma.$executeRaw` (tagged template → sin inyección). Es la ÚNICA escritura
 * del módulo y va SOLO a la tabla propia en KRONOSDB_PRUEBAS; NUNCA toca SAP.
 *
 * Estrategia: se intenta UPDATE; si no afectó filas (empresa nueva), se hace el
 * INSERT. Devuelve la configuración ya persistida (re-leída con getDispersionConfig).
 */
export async function upsertDispersionConfig(
  idCompany: number,
  input: DispersionConfigInput
): Promise<DispersionConfig | null> {
  const {
    cuentaDispersora,
    tipoCuenta,
    nit,
    tipoMovimiento,
    codigoCiudad,
    codigoOficina,
    tipoId,
    nombreEmpresa,
    carpetaSalida,
  } = input;

  const updated = await prisma.$executeRaw`
    UPDATE [dbo].[payment_dispersion_config]
    SET cuenta_dispersora = ${cuentaDispersora},
        tipo_cuenta       = ${tipoCuenta},
        nit               = ${nit},
        tipo_movimiento   = ${tipoMovimiento},
        codigo_ciudad     = ${codigoCiudad},
        codigo_oficina    = ${codigoOficina},
        tipo_id           = ${tipoId},
        nombre_empresa    = ${nombreEmpresa},
        carpeta_salida    = ${carpetaSalida}
    WHERE id_company = ${idCompany}
  `;

  if (updated === 0) {
    await prisma.$executeRaw`
      INSERT INTO [dbo].[payment_dispersion_config]
        (id_company, cuenta_dispersora, tipo_cuenta, nit, tipo_movimiento,
         codigo_ciudad, codigo_oficina, tipo_id, nombre_empresa, carpeta_salida)
      VALUES
        (${idCompany}, ${cuentaDispersora}, ${tipoCuenta}, ${nit}, ${tipoMovimiento},
         ${codigoCiudad}, ${codigoOficina}, ${tipoId}, ${nombreEmpresa}, ${carpetaSalida})
    `;
  }

  return getDispersionConfig(idCompany);
}
