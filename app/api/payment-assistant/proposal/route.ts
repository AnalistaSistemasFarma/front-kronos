import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/payment-assistant/access';
import {
  getOpenSupplierInvoices,
  getSupplierBankAccounts,
  buildPaymentProposal,
  type SupplierBankAccount,
} from '../../../../lib/payments/proposal';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Propuesta de pago (SOLO LECTURA) de UNA empresa.
 *
 * GET /api/payment-assistant/proposal?companyId=<id>
 *
 * Valida el acceso del usuario a la empresa, inicia sesion en el Service Layer
 * con las credenciales de sap_endpoints (nunca salen al navegador), lee las
 * facturas de proveedor abiertas y las cuentas bancarias de cada proveedor, y
 * arma la propuesta. NO escribe nada en SAP.
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
      // 1) Facturas de proveedor abiertas (SOLO LECTURA).
      const invoices = await getOpenSupplierInvoices(sap);

      // 2) Cuentas bancarias + pais por proveedor (una consulta por cardCode unico).
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

      // 3) Armado de la propuesta (funcion pura), con clasificacion nacional/exterior.
      const proposal = buildPaymentProposal(invoices, bankByCardCode, countryByCardCode);

      return NextResponse.json({
        companyId: access.idCompany,
        companyName: access.companyName,
        proposal,
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    console.error('Error armando propuesta de pago:', error);
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
