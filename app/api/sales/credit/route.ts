import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { companySap } from '../../../../lib/purchases/authorization';
import { canReadLinkedSale } from '../../../../lib/sales/requestAccess';
import { rulesFor } from '../../../../lib/sales/flow';
import { aging, analyzeCredit, toOpenInvoices } from '../../../../lib/sales/credit';
import { sapGet, sapGetAll, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Cupo y cartera por edades del cliente de la oferta enlazada a una solicitud, para que
 * cartera decida el extracupo con datos (Nicolás Rivera, 2026-11-03). Datos de SAP del
 * momento. GET ?requestId=N -> { credit, aging, invoices } o { sale: null }.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const requestId = Number(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({ sale: null });
    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('r', sql.Int, requestId).query(
      `SELECT TOP 1 id_company, doc_entry FROM dbo.sales_authorization WHERE id_request_general = @r;`
    );
    const link = r.recordset[0];
    if (!link) return NextResponse.json({ sale: null });
    if (!(await canReadLinkedSale(session.user.email, requestId, link.id_company))) {
      return NextResponse.json({ error: 'Sin acceso a esta oferta de venta' }, { status: 403 });
    }
    const rules = await rulesFor(link.id_company);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const sap = await companySap(link.id_company);
    try {
      const draft = await sapGet<{ CardCode: string; CardName?: string; DocTotal?: number }>(sap, `Drafts(${link.doc_entry})?$select=CardCode,CardName,DocTotal`);
      const card = String(draft.CardCode).replace(/'/g, "''");
      const bp = await sapGet<Record<string, number>>(
        sap,
        `BusinessPartners('${encodeURIComponent(card)}')?$select=CreditLimit,CurrentAccountBalance,OpenDeliveryNotesBalance,OpenOrdersBalance`
      );
      let otras = 0;
      if (rules.estadosSumaCupo.length) {
        const states = rules.estadosSumaCupo.map((s) => `U_SEND_State eq '${s}'`).join(' or ');
        const rows = await sapGetAll<{ DocEntry: number; DocTotal: number }>(
          sap,
          `Drafts?$select=DocEntry,DocTotal&$filter=CardCode eq '${card}' and DocObjectCode eq 'oOrders' and DocumentStatus eq 'bost_Open' and (${states})`,
          { cap: 2000 }
        );
        otras = rows.filter((x) => Number(x.DocEntry) !== Number(link.doc_entry)).reduce((a, x) => a + Number(x.DocTotal ?? 0), 0);
      }
      const credit = analyzeCredit({
        creditLimit: Number(bp.CreditLimit ?? 0),
        pctTolerancia: rules.pctToleranciaCupo,
        saldo: Number(bp.CurrentAccountBalance ?? 0),
        entregasAbiertas: Number(bp.OpenDeliveryNotesBalance ?? 0),
        pedidosAbiertos: Number(bp.OpenOrdersBalance ?? 0),
        otrasOfertas: otras,
        estaOferta: Number(draft.DocTotal ?? 0),
      });
      const invRows = await sapGetAll<Record<string, unknown>>(
        sap,
        `Invoices?$select=DocNum,DocDate,DocDueDate,DocTotal,PaidToDate&$filter=CardCode eq '${card}' and DocumentStatus eq 'bost_Open'`,
        { cap: 5000 }
      );
      const invoices = toOpenInvoices(invRows, today);
      return NextResponse.json(
        { cardCode: draft.CardCode, cardName: draft.CardName, today, credit, aging: aging(invoices), invoices: invoices.slice(0, 100), invoiceCount: invoices.length },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando cupo y cartera de la oferta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
