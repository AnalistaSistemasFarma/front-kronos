import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/payment-assistant/access';
import { getDispersionConfig } from '../../../../lib/payment-assistant/dispersionConfig';
import {
  getOpenSupplierInvoices,
  getSupplierBankAccounts,
  getSupplierIdentity,
  buildPaymentProposal,
  type SupplierBankAccount,
} from '../../../../lib/payments/proposal';
import {
  proposalToDisfon,
  deriveBeneficiaryIdentity,
  type BeneficiaryIdentity,
} from '../../../../lib/payments/disfonMapping';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * GENERACIÓN del archivo DISFON en el SERVIDOR (Asistente de Pagos).
 *
 * POST /api/payment-assistant/generate-disfon?companyId=<id>
 *
 * A diferencia de `simulate` (que solo previsualiza en memoria), este endpoint
 * ESCRIBE el archivo plano DISFON de los pagos NACIONALES en una carpeta local
 * del servidor (`carpeta_salida` de la configuración de dispersión). La idea es
 * que el banco lo recoja de esa carpeta por H2H/MFT.
 *
 * ALCANCE DE ESCRITURA (deliberadamente acotado):
 *   - Hacia SAP: SOLO LECTURA (facturas, cuentas bancarias, identidad del BP).
 *   - La ÚNICA escritura nueva es el archivo .txt en la carpeta local del
 *     servidor. NO hay escritura en SAP, NO se cifra con PGP, NO se transmite
 *     al banco por MFT y NO se hace ningún POST a sistemas externos.
 *
 * PENDIENTE (infra, se agrega después):
 *   - Cifrado PGP del plano antes de dejarlo en la carpeta.
 *   - Conexión/transmisión MFT (H2H) hacia el Banco de Bogotá.
 *   - En producción, este proceso irá GATILLADO por la APROBACIÓN del pago
 *     (hoy es una acción manual del operador, sin aprobación formal).
 */

/**
 * Convierte el nombre de una empresa en un "slug" seguro para nombre de archivo:
 * sin acentos, en minúsculas, solo [a-z0-9] y guiones. Ej.: "Farmalógica S.A."
 * -> "farmalogica-s-a".
 */
function slugEmpresa(name: string): string {
  return (name || 'empresa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'empresa';
}

/** Consecutivo AAAAMMDDHHmmss a partir de una fecha (runtime del server). */
function consecutivoTimestamp(now: Date): string {
  return (
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyIdRaw = request.nextUrl.searchParams.get('companyId');
    const companyId = Number(companyIdRaw);
    if (!companyIdRaw || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    // Acceso (nivel write) del usuario a la empresa. getCompanyEndpointForUser
    // exige pertenencia al módulo en esa empresa + endpoint SAP listo.
    const access = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!access || !access.endpoint) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa o no esta configurada.' },
        { status: 403 }
      );
    }

    // 1) Configuración de dispersión (cabecera + carpeta de salida).
    const config = await getDispersionConfig(access.idCompany);
    if (!config) {
      return NextResponse.json(
        {
          error:
            'La empresa no tiene configuración de dispersión. Configúrela antes de generar el archivo DISFON.',
        },
        { status: 400 }
      );
    }

    const carpetaSalida = (config.carpetaSalida ?? '').trim();
    if (!carpetaSalida) {
      return NextResponse.json(
        { error: 'Configure primero la carpeta de salida.' },
        { status: 400 }
      );
    }

    // 2) Validar/crear la carpeta de salida y comprobar que sea escribible.
    try {
      await fs.mkdir(carpetaSalida, { recursive: true });
      // Comprobación explícita de permiso de escritura.
      await fs.access(carpetaSalida, fs.constants.W_OK);
    } catch {
      return NextResponse.json(
        {
          error:
            `No se pudo usar la carpeta de salida "${carpetaSalida}": no existe, no se pudo crear ` +
            'o no hay permiso de escritura en el servidor. Verifique la ruta y los permisos.',
        },
        { status: 400 }
      );
    }

    const ep = access.endpoint;
    const sap = await sapLogin({
      baseUrl: ep.baseUrl,
      username: ep.username,
      password: ep.password,
      companyDB: ep.companyDB,
    });

    try {
      // 3) Propuesta de pago (SOLO LECTURA): igual que en `simulate`.
      const invoices = await getOpenSupplierInvoices(sap);
      const cardCodes = [...new Set(invoices.map((i) => i.cardCode).filter(Boolean))];
      const bankByCardCode: Record<string, SupplierBankAccount[]> = {};
      const countryByCardCode: Record<string, string> = {};
      const bankResults = await Promise.allSettled(
        cardCodes.map(async (cardCode) => ({
          cardCode,
          data: await getSupplierBankAccounts(sap, cardCode),
        }))
      );
      for (const result of bankResults) {
        if (result.status === 'fulfilled') {
          bankByCardCode[result.value.cardCode] = result.value.data.accounts;
          countryByCardCode[result.value.cardCode] = result.value.data.country;
        }
      }
      const proposal = buildPaymentProposal(invoices, bankByCardCode, countryByCardCode);

      // Solo NACIONALES: el DISFON es dispersión nacional del Banco de Bogotá.
      const nationalGroups = proposal.nationalGroups;
      if (nationalGroups.length === 0) {
        return NextResponse.json(
          { error: 'No hay pagos nacionales para generar el archivo DISFON.' },
          { status: 400 }
        );
      }

      // 3b) Identidad del beneficiario (SOLO LECTURA): FederalTaxID del BP.
      const identities: Record<string, BeneficiaryIdentity> = {};
      const identityResults = await Promise.allSettled(
        cardCodes.map(async (cardCode) => ({
          cardCode,
          identity: await getSupplierIdentity(sap, cardCode),
        }))
      );
      for (const result of identityResults) {
        if (result.status !== 'fulfilled') continue;
        const derived = deriveBeneficiaryIdentity(result.value.identity.federalTaxID);
        if (derived) identities[result.value.cardCode] = derived;
      }

      // 4) Fecha de aplicación/elaboración = hoy (AAAAMMDD).
      const now = new Date();
      const fechaAplicacion =
        `${now.getFullYear()}` +
        `${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`;

      // 5) Mapeo a DISFON (función pura).
      const { fileText, warnings, detailCount } = proposalToDisfon(
        config,
        nationalGroups,
        { fechaAplicacion, identities }
      );

      if (!fileText) {
        return NextResponse.json(
          {
            error:
              'No se generó contenido DISFON (revise las validaciones y la configuración de dispersión).',
            warnings,
          },
          { status: 400 }
        );
      }

      // 6) Escribir el archivo en la carpeta local del servidor.
      //    DISFON es un plano de ANCHO FIJO ASCII -> se escribe en latin1 para
      //    no introducir bytes multibyte (UTF-8) que dañen las posiciones.
      const consecutivo = consecutivoTimestamp(now);
      const fileName = `DIS_${slugEmpresa(access.companyName)}_${consecutivo}.txt`;
      const filePath = path.join(carpetaSalida, fileName);

      // NOTA: aquí NO se cifra con PGP ni se transmite al banco (MFT). Esos
      // pasos quedan pendientes de infra. Solo se deja el .txt en la carpeta.
      await fs.writeFile(filePath, fileText, { encoding: 'latin1' });

      const bytes = Buffer.byteLength(fileText, 'latin1');
      const lines = fileText.split('\n').filter((l) => l.length > 0).length;

      return NextResponse.json({
        ok: true,
        path: filePath,
        bytes,
        lines,
        detailCount,
        warnings,
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    console.error('Error generando el archivo DISFON en el servidor:', error);
    const message =
      error instanceof SapError
        ? error.friendly
        : error instanceof Error
          ? error.message
          : 'Error interno';
    const status = error instanceof SapError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
