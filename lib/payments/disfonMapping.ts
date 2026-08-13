// ---------------------------------------------------------------------------
// Mapeo Propuesta de pago -> archivo DISFON (Banco de Bogotá). FUNCIÓN PURA.
//
// Es la pieza clave del "motor de simulación": toma la CONFIGURACIÓN DE
// DISPERSIÓN de la empresa (cabecera) + los grupos de proveedores de la
// propuesta (`SupplierGroup[]`) y produce el TEXTO del archivo DISFON usando el
// generador validado `buildFile`, junto con una lista de `warnings` con los
// problemas encontrados (sin banco, sin cuenta, sin identificación, monto 0…).
//
// Decisiones de diseño (documentadas):
//   - GRANULARIDAD: por ahora se emite UN RENGLÓN POR PROVEEDOR con el TOTAL
//     PENDIENTE del proveedor (suma de sus facturas). No se hace un renglón por
//     factura. Si más adelante se requiere pago factura por factura, se agrega
//     un modo alterno; hoy el banco recibe un abono consolidado por proveedor.
//   - IDENTIFICACIÓN DEL BENEFICIARIO: la propuesta NO trae hoy la
//     identificación del proveedor (tipo y número de documento). Se acepta como
//     parámetro (`opts.identities`, mapa cardCode -> {tipoId, numeroId}). TODO:
//     poblarla leyendo `BusinessPartners` (campo `FederalTaxID`) del Service
//     Layer y su tipo de documento, aguas arriba, para no depender del mapa.
//   - NO LANZA por dato faltante: cada problema se reporta como warning y el
//     archivo se arma igual (con los defaults del layout) para poder PREVISUALIZAR.
//
// PURA: no toca red, SAP ni base de datos, y no agrega dependencias.
// ---------------------------------------------------------------------------

import { buildFile, type Empresa, type Pago } from './disfon';
import { resolveBankCode } from './bankCodes';
import type { SupplierGroup } from './proposal';

/** Identificación del beneficiario (proveedor) para el DISFON. */
export interface BeneficiaryIdentity {
  /** Tipo de identificación (C/N/T/E/L/I/P). */
  tipoId: string;
  /** Número de identificación. */
  numeroId: string;
}

/** Configuración de la empresa dispersora usada para armar la cabecera. */
export interface DisfonEmpresaConfig {
  cuentaDispersora: string;
  tipoCuenta: string;
  nit: string;
  tipoMovimiento: string;
  codigoCiudad: string;
  codigoOficina: string;
  tipoId: string;
  nombreEmpresa: string | null;
}

/** Opciones del mapeo: fechas y el mapa de identidades por proveedor. */
export interface ProposalToDisfonOpts {
  /** Fecha de aplicación AAAAMMDD (obligatoria). */
  fechaAplicacion: string;
  /** Fecha de elaboración AAAAMMDD (default = fechaAplicacion). */
  fechaElaboracion?: string;
  /** Mapa cardCode -> identificación del beneficiario. Opcional. */
  identities?: Record<string, BeneficiaryIdentity>;
  /** Addenda por defecto de cada detalle. Default "PAGO PROVEEDORES". */
  addenda?: string;
}

/** Resultado del mapeo: el texto del archivo y los avisos. */
export interface ProposalToDisfonResult {
  /** Texto del archivo DISFON (líneas de 250 caracteres). Vacío si no hay pagos. */
  fileText: string;
  /** Problemas detectados por proveedor (no bloquean la previsualización). */
  warnings: string[];
  /** Cantidad de detalles (renglones de pago) emitidos. */
  detailCount: number;
}

/** Solo dígitos (para números de identificación / cuentas numéricas). */
function digitsOnly(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Convierte la propuesta (grupos de proveedores) en el archivo DISFON.
 *
 * @param config Configuración de dispersión de la empresa (cabecera).
 * @param groups Grupos de proveedores seleccionados de la propuesta.
 * @param opts   Fechas AAAAMMDD e identidades por proveedor.
 */
export function proposalToDisfon(
  config: DisfonEmpresaConfig,
  groups: SupplierGroup[],
  opts: ProposalToDisfonOpts
): ProposalToDisfonResult {
  const warnings: string[] = [];
  const addenda = opts.addenda ?? 'PAGO PROVEEDORES';

  const empresa: Empresa = {
    fechaAplicacion: opts.fechaAplicacion,
    fechaElaboracion: opts.fechaElaboracion ?? opts.fechaAplicacion,
    tipoCuenta: config.tipoCuenta || '1',
    numeroCuenta: digitsOnly(config.cuentaDispersora),
    nombre: config.nombreEmpresa ?? '',
    nit: digitsOnly(config.nit),
    tipoMovimiento: config.tipoMovimiento || '002',
    codigoCiudad: config.codigoCiudad || '0000',
    codigoOficina: config.codigoOficina || '000',
    tipoId: config.tipoId || 'N',
  };

  const pagos: Pago[] = [];

  for (const group of groups) {
    const label = `${group.cardName || group.cardCode || '(sin nombre)'}`;

    // 1) Monto: total pendiente del proveedor -> centavos.
    const valorCents = Math.round(group.totalPending * 100);
    if (valorCents <= 0) {
      warnings.push(`${label}: monto a pagar es 0 o negativo (${group.totalPending}).`);
    }

    // 2) Cuenta bancaria del beneficiario (la por defecto).
    const account = group.defaultBankAccount;
    if (!account || !account.accountNo) {
      warnings.push(`${label}: sin cuenta bancaria; el renglón queda sin cuenta.`);
    }

    // 3) Código de banco de compensación (ACH). null -> warning + fallback '000'.
    let codigoBanco = '000';
    if (account && account.bankCode) {
      const resolved = resolveBankCode(account.bankCode);
      if (resolved) {
        codigoBanco = resolved;
      } else {
        warnings.push(
          `${label}: banco "${account.bankCode}" no está en el catálogo de códigos de compensación.`
        );
      }
    } else if (account) {
      warnings.push(`${label}: la cuenta no tiene banco asociado.`);
    }

    // 4) Identificación del beneficiario (viene por parámetro; TODO: SAP).
    const identity = opts.identities?.[group.cardCode];
    let tipoId = 'N';
    let numeroId = '';
    if (identity && identity.numeroId) {
      tipoId = identity.tipoId || 'N';
      numeroId = digitsOnly(identity.numeroId);
      if (numeroId.length > 11) {
        warnings.push(
          `${label}: identificación "${identity.numeroId}" excede 11 dígitos; se trunca a los últimos 11.`
        );
        numeroId = numeroId.slice(-11);
      }
    } else {
      warnings.push(`${label}: sin identificación del beneficiario (se envía en ceros).`);
    }

    // 5) Nº de factura: solo si el proveedor tiene UNA factura (abono por factura).
    //    Con varias facturas se consolida y se deja el default '0'.
    const numeroFactura =
      group.invoices.length === 1 ? String(group.invoices[0].docNum ?? 0) : '0';

    // Tipo de cuenta del beneficiario (1 cte / 2 ahorros / 5 rotativo): la
    // propuesta no lo trae hoy, así que se asume corriente ('1').
    // TODO: obtenerlo del Service Layer (BPBankAccounts) aguas arriba.
    pagos.push({
      tipoId,
      numeroId,
      nombre: group.cardName ?? '',
      tipoCuenta: '1',
      numeroCuenta: account?.accountNo ?? '',
      valorCents,
      codigoBanco,
      addenda,
      numeroFactura,
    });
  }

  const fileText = pagos.length > 0 ? buildFile(empresa, pagos) : '';

  return { fileText, warnings, detailCount: pagos.length };
}
