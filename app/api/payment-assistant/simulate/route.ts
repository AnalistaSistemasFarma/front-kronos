import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/payment-assistant/access';
import { getDispersionConfig } from '../../../../lib/payment-assistant/dispersionConfig';
import {
  getOpenSupplierInvoices,
  getSupplierBankAccounts,
  buildPaymentProposal,
  type SupplierBankAccount,
} from '../../../../lib/payments/proposal';
import { proposalToDisfon } from '../../../../lib/payments/disfonMapping';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Motor de SIMULACIÓN del Asistente de Pagos (SOLO LECTURA).
 *
 * GET /api/payment-assistant/simulate?companyId=<id>
 *
 * Arma la propuesta de pago de la empresa (facturas de proveedor abiertas +
 * cuentas bancarias), lee la configuración de dispersión (cabecera DISFON) y
 * genera el PREVIEW del archivo DISFON del Banco de Bogotá junto con las
 * validaciones (warnings). NO escribe nada en SAP, NO genera archivos en disco
 * y NO transmite al banco: solo devuelve el texto para previsualizar.
 *
 * Si la empresa no tiene configuración de dispersión, responde 200 con el
 * preview vacío y un warning indicándolo (no rompe).
 */
export async function GET(request: NextRequest) {
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

    const access = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!access || !access.endpoint) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa o no esta configurada.' },
        { status: 403 }
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
      // 1) Propuesta de pago (SOLO LECTURA): facturas abiertas + cuentas bancarias.
      const invoices = await getOpenSupplierInvoices(sap);
      const cardCodes = [...new Set(invoices.map((i) => i.cardCode).filter(Boolean))];
      const bankByCardCode: Record<string, SupplierBankAccount[]> = {};
      const bankResults = await Promise.allSettled(
        cardCodes.map(async (cardCode) => ({
          cardCode,
          accounts: await getSupplierBankAccounts(sap, cardCode),
        }))
      );
      for (const result of bankResults) {
        if (result.status === 'fulfilled') {
          bankByCardCode[result.value.cardCode] = result.value.accounts;
        }
      }
      const proposal = buildPaymentProposal(invoices, bankByCardCode);

      // 2) Configuración de dispersión de la empresa (cabecera DISFON).
      const config = await getDispersionConfig(access.idCompany);

      // Sin configuración: no rompemos, devolvemos preview vacío + warning.
      if (!config) {
        return NextResponse.json({
          companyId: access.idCompany,
          companyName: access.companyName,
          preview: '',
          warnings: [
            'La empresa no tiene configuración de dispersión (payment_dispersion_config). ' +
              'Configúrela para poder generar el archivo DISFON.',
          ],
          summary: {
            supplierCount: proposal.supplierCount,
            invoiceCount: proposal.invoiceCount,
            grandTotalPending: proposal.grandTotalPending,
            detailCount: 0,
            suppliersMissingBank: proposal.suppliersMissingBank.length,
          },
        });
      }

      // 3) Fecha de aplicación/elaboración = hoy (AAAAMMDD).
      const now = new Date();
      const fechaAplicacion =
        `${now.getFullYear()}` +
        `${String(now.getMonth() + 1).padStart(2, '0')}` +
        `${String(now.getDate()).padStart(2, '0')}`;

      // 4) Mapeo a DISFON (función pura). Las identidades se poblarán aguas
      //    arriba (BusinessPartners/FederalTaxID); hoy van vacías -> warnings.
      const { fileText, warnings, detailCount } = proposalToDisfon(
        config,
        proposal.groups,
        { fechaAplicacion }
      );

      return NextResponse.json({
        companyId: access.idCompany,
        companyName: access.companyName,
        preview: fileText,
        warnings,
        summary: {
          supplierCount: proposal.supplierCount,
          invoiceCount: proposal.invoiceCount,
          grandTotalPending: proposal.grandTotalPending,
          detailCount,
          suppliersMissingBank: proposal.suppliersMissingBank.length,
        },
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    console.error('Error simulando el archivo DISFON:', error);
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
