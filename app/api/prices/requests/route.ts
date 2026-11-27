import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { createGeneralRequest } from '../../../../lib/requests-general/createGeneralRequest';
import { currentPrices, customerContext } from '../../../../lib/prices/service';
import { pctChange, priceRequestSubject, sanitizePriceLines } from '../../../../lib/prices/rules';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Creates the "price list update" request: validates customer and items in SAP, stores the current and new price
 * of each line and opens the workflow request (approval → SAP task "apply prices").
 * POST { companyId, cardCode, lines: [{ itemCode, newPrice }], comment? } -> { idRequest }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim().slice(0, 50);
    const comment = String(body.comment ?? '').trim().slice(0, 500);
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Elija el cliente.' }, { status: 400 });
    const { lines, errors } = sanitizePriceLines(body.lines);
    if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 422 });
    const a = await salesEndpointForUser(email, companyId, 'write');
    if (!a?.endpoint) return NextResponse.json({ error: 'Sin permiso de Ventas en esta empresa.' }, { status: 403 });
    const pool = await sql.connect(sqlConfig);
    const cfg = await pool.request().input('c', sql.Int, companyId).query(
      `SELECT TOP 1 id_process_category_price_list AS p FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
    );
    const processId = Number(cfg.recordset[0]?.p ?? 0);
    if (!processId) return NextResponse.json({ error: 'La empresa no tiene configurado el flujo de actualización de listas de precios.' }, { status: 422 });
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 401 });

    const sap = await sapLogin(a.endpoint);
    let ctx;
    let cur;
    try {
      ctx = await customerContext(sap, cardCode);
      cur = await currentPrices(sap, ctx, lines.map((l) => l.itemCode));
    } finally {
      await sapLogout(sap);
    }
    const bad = lines.filter((l) => !cur.get(l.itemCode)?.exists || !cur.get(l.itemCode)?.salesItem).map((l) => l.itemCode);
    if (bad.length) return NextResponse.json({ error: `Estos artículos no existen o no son de venta en SAP: ${bad.join(', ')}.` }, { status: 422 });

    const summary = lines
      .slice(0, 15)
      .map((l) => {
        const c = cur.get(l.itemCode)!;
        const v = pctChange(c.current, l.newPrice);
        return `${l.itemCode} ${c.itemName ?? ''}: ${c.current ?? '—'} → ${l.newPrice}${v != null ? ` (${v > 0 ? '+' : ''}${v} %)` : ''}`;
      })
      .join('\n');
    const modeText = ctx.mode === 'list' ? `Se actualiza la lista «${ctx.priceListName ?? ctx.priceListNum}» del cliente.` : `La lista «${ctx.priceListName ?? '—'}» es compartida o no aplica: se crean precios especiales solo para este cliente.`;
    const { id_request: idRequest } = await createGeneralRequest({
      company: companyId,
      subject: priceRequestSubject(ctx.cardName, ctx.cardCode, lines.length),
      descripcion: `${comment ? `${comment}\n\n` : ''}${modeText}\n${summary}${lines.length > 15 ? `\n… y ${lines.length - 15} más` : ''}`.slice(0, 3900),
      process: processId,
      createdby: user.id,
      url: `/process/request-general/view-request`,
      formValues: [],
    });
    const head = await pool.request()
      .input('c', sql.Int, companyId).input('r', sql.Int, idRequest).input('cc', sql.NVarChar(50), ctx.cardCode).input('cn', sql.NVarChar(200), ctx.cardName)
      .input('pl', sql.Int, ctx.priceListNum).input('pn', sql.NVarChar(100), ctx.priceListName).input('sh', sql.Bit, ctx.mode === 'special' ? 1 : 0)
      .input('com', sql.NVarChar(500), comment || null).input('u', sql.NVarChar(50), user.id)
      .query(`INSERT INTO dbo.price_update (id_company, id_request_general, card_code, card_name, price_list_num, price_list_name, shared_list, status, comment, created_by)
              OUTPUT INSERTED.id VALUES (@c, @r, @cc, @cn, @pl, @pn, @sh, N'pending', @com, @u);`);
    const idHead = Number(head.recordset[0].id);
    let n = 0;
    for (const l of lines) {
      const c = cur.get(l.itemCode)!;
      await pool.request()
        .input('h', sql.Int, idHead).input('n', sql.Int, n++).input('ic', sql.NVarChar(50), l.itemCode).input('in', sql.NVarChar(200), c.itemName)
        .input('cp', sql.Decimal(19, 6), c.current).input('np', sql.Decimal(19, 6), l.newPrice).input('cur', sql.NVarChar(3), c.currency)
        .input('m', sql.NVarChar(10), ctx.mode)
        .query(`INSERT INTO dbo.price_update_line (id_price_update, line_num, item_code, item_name, current_price, new_price, currency, mode) VALUES (@h, @n, @ic, @in, @cp, @np, @cur, @m);`);
    }
    return NextResponse.json({ ok: true, idRequest, mode: ctx.mode }, { status: 201 });
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('[prices/requests] POST', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
