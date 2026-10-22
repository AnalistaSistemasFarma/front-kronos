import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../../lib/purchases/access';
import { sendToAuthorize } from '../../../../../lib/purchases/authorization';
import {
  BULK_MAX_GROUPS,
  BULK_MAX_ROWS,
  fillMissingPrices,
  groupBulkRows,
  type BulkRow,
  type PriceLookups,
} from '../../../../../lib/purchases/bulk';
import { buildCreatePayload, validateDraft } from '../../../../../lib/purchases/drafts';
import { resolveRequester } from '../../../../../lib/purchases/requester';
import { prisma } from '../../../../../lib/prisma';
import { sapLookups, validateLinesInSap } from '../../../../../lib/purchases/validateSap';
import { sapGet, sapLogin, sapLogout, sapPost, SapError, type SapSession } from '../../../../../lib/sap/serviceLayer';

/**
 * Carga masiva de solicitudes de compra: un borrador (B) por proveedor y, si se
 * pide (`send: true`), cada uno se envia a autorizar. Nunca aprueba en firme.
 *
 * Body: { companyId, rows: BulkRow[] (filas del Excel ya leidas), send?: boolean }
 * Los grupos se procesan EN SECUENCIA (no en paralelo) para no saturar el Service
 * Layer; un grupo con error no detiene a los demas. Permiso de ESCRITURA.
 */

/** Clave de texto para Entidad('X'): comillas dobladas y codificada en la URL. */
const key = (v: string) => encodeURIComponent(v.replace(/'/g, "''"));

function priceLookups(sap: SapSession): PriceLookups {
  return {
    priceListOf: async (cardCode) => {
      try {
        const bp = await sapGet<{ PriceListNum?: number | null }>(sap, `BusinessPartners('${key(cardCode)}')?$select=PriceListNum`);
        return bp.PriceListNum ?? null;
      } catch (e) {
        if (e instanceof SapError && e.status === 404) return null;
        throw e;
      }
    },
    itemPrices: async (itemCode) => {
      try {
        const it = await sapGet<{ ItemPrices?: Array<{ PriceList: number; Price: number | null }> }>(
          sap,
          `Items('${key(itemCode)}')?$select=ItemPrices`
        );
        return it.ItemPrices ?? [];
      } catch (e) {
        if (e instanceof SapError && e.status === 404) return [];
        throw e;
      }
    },
  };
}

type GroupResult = {
  cardCode: string;
  rows: number[];
  ok: boolean;
  docEntry?: number;
  sent?: boolean;
  error?: string;
  errors?: { field: string; error: string }[];
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const email = session.user.email;

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const rows: BulkRow[] = Array.isArray(body.rows) ? body.rows : [];
    const send = body.send === true;
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    if (rows.length === 0) return NextResponse.json({ error: 'El archivo no trae filas.' }, { status: 400 });
    if (rows.length > BULK_MAX_ROWS) {
      return NextResponse.json({ error: `Maximo ${BULK_MAX_ROWS} filas por carga.` }, { status: 413 });
    }

    // Moneda y bodega por defecto de la empresa (SAPSEND: COP; Ryan: sin moneda y bodega MPR01).
    const config = await prisma.purchaseCompanyConfig.findUnique({ where: { id_company: companyId } });
    const { groups, invalid } = groupBulkRows(rows, {
      currency: config?.default_currency ?? undefined,
      warehouse: config?.default_warehouse ?? undefined,
    });
    if (groups.length === 0) return NextResponse.json({ error: 'Ninguna fila es valida.', invalid }, { status: 422 });
    if (groups.length > BULK_MAX_GROUPS) {
      return NextResponse.json(
        { error: `Maximo ${BULK_MAX_GROUPS} proveedores (borradores) por carga; el archivo trae ${groups.length}.` },
        { status: 413 }
      );
    }

    const company = await getCompanyEndpointForUser(email, companyId, 'write');
    if (!company?.endpoint) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }
    const who = await resolveRequester(email, companyId);
    if (!who.ok) return NextResponse.json({ error: who.error }, { status: 422 });

    const sap = await sapLogin(company.endpoint);
    try {
      const priceWarnings = await fillMissingPrices(groups, priceLookups(sap));
      const lookups = sapLookups(sap);
      const results: GroupResult[] = [];

      for (const g of groups) {
        const base = { cardCode: g.cardCode, rows: g.rows };
        try {
          const errors = [...validateDraft(g.header, g.lines), ...(await validateLinesInSap(g.lines, lookups))];
          if (errors.length > 0) {
            results.push({ ...base, ok: false, error: 'Datos invalidos', errors });
            continue;
          }
          const created = await sapPost<{ DocEntry: number }>(sap, 'Drafts', buildCreatePayload(g.header, g.lines, who.requester));
          const result: GroupResult = { ...base, ok: true, docEntry: created.DocEntry, sent: false };
          if (send) {
            const s = await sendToAuthorize({ sap, companyId, docEntry: created.DocEntry, userEmail: email });
            if (s.ok) result.sent = true;
            else result.error = `Borrador creado, pero no se envio a autorizar: ${s.error}`;
          }
          results.push(result);
        } catch (e) {
          results.push({ ...base, ok: false, error: e instanceof SapError ? e.friendly : 'Error inesperado' });
        }
      }

      return NextResponse.json({
        created: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
        invalid,
        priceWarnings,
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en carga masiva de compras:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
