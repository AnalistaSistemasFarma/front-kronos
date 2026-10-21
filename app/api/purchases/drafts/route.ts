import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import {
  buildCreatePayload,
  buildUpdatePayload,
  EDITABLE_STATES,
  sanitizeLine,
  validateDraft,
} from '../../../../lib/purchases/drafts';
import { resolveRequester } from '../../../../lib/purchases/requester';
import { prisma } from '../../../../lib/prisma';
import { sapLookups, validateLinesInSap } from '../../../../lib/purchases/validateSap';
import { sapGet, sapLogin, sapLogout, sapPatch, sapPost, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Crear (POST) y editar (PATCH) borradores de solicitud de compra en SAP
 * (Drafts, oPurchaseRequest). Quedan visibles y operables en SAPSEND porque se
 * escriben con los mismos campos U_SEND_*.
 *
 * Body: { companyId, header: { Comments, RequriedDate?, U_SEND_Ane? }, lines: [...] }
 * PATCH ademas: { docEntry }. Requiere permiso de ESCRITURA en la empresa.
 */

async function parseBody(body: Record<string, unknown>, companyId: number) {
  const header = (body.header ?? {}) as Record<string, string>;
  const rawLines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  const lines = rawLines.map(sanitizeLine);
  // Moneda por defecto de la empresa en lineas sin moneda (SAPSEND: 'COP'; Ryan: vacia).
  const config = companyId
    ? await prisma.purchaseCompanyConfig.findUnique({ where: { id_company: companyId } })
    : null;
  if (config?.default_currency) {
    for (const l of lines) if (!l.Currency) l.Currency = config.default_currency;
  }
  return { header, lines, errors: validateDraft(header, lines) };
}

async function openSap(email: string, companyId: number) {
  const company = await getCompanyEndpointForUser(email, companyId, 'write');
  if (!company?.endpoint) return null;
  return sapLogin(company.endpoint);
}

function sapErrorResponse(error: unknown, context: string) {
  if (error instanceof SapError) {
    return NextResponse.json({ error: error.friendly }, { status: error.status });
  }
  console.error(context, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });

    const { header, lines, errors } = await parseBody(body, companyId);
    if (errors.length > 0) return NextResponse.json({ error: 'Datos invalidos', errors }, { status: 422 });

    const sap = await openSap(session.user.email, companyId);
    if (!sap) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    try {
      const who = await resolveRequester(session.user.email, companyId);
      if (!who.ok) return NextResponse.json({ error: who.error }, { status: 422 });

      const sapErrors = await validateLinesInSap(lines, sapLookups(sap));
      if (sapErrors.length > 0) {
        return NextResponse.json({ error: 'Hay valores que no existen en SAP', errors: sapErrors }, { status: 422 });
      }

      const created = await sapPost<{ DocEntry: number }>(
        sap,
        'Drafts',
        buildCreatePayload(header, lines, who.requester)
      );
      return NextResponse.json({ ok: true, docEntry: created.DocEntry, state: 'B' }, { status: 201 });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    return sapErrorResponse(error, 'Error creando solicitud de compra:');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const docEntry = Number(body.docEntry);
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }

    const { header, lines, errors } = await parseBody(body, companyId);
    if (errors.length > 0) return NextResponse.json({ error: 'Datos invalidos', errors }, { status: 422 });

    const sap = await openSap(session.user.email, companyId);
    if (!sap) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    try {
      const current = await sapGet<Record<string, unknown>>(
        sap,
        `Drafts(${docEntry})?$select=DocEntry,DocObjectCode,U_SEND_State`
      );
      if (current.DocObjectCode !== 'oPurchaseRequest') {
        return NextResponse.json({ error: 'El documento no es una solicitud de compra' }, { status: 404 });
      }
      const state = String(current.U_SEND_State ?? '');
      if (!(EDITABLE_STATES as readonly string[]).includes(state)) {
        return NextResponse.json(
          { error: `Solo se puede editar en estado B o ENC; estado actual: ${state || 'sin estado'}` },
          { status: 409 }
        );
      }

      const sapErrors = await validateLinesInSap(lines, sapLookups(sap));
      if (sapErrors.length > 0) {
        return NextResponse.json({ error: 'Hay valores que no existen en SAP', errors: sapErrors }, { status: 422 });
      }

      await sapPatch(sap, `Drafts(${docEntry})`, buildUpdatePayload(header, lines), true, {
        ifMatch: current['odata.etag'] as string | undefined,
      });
      return NextResponse.json({ ok: true, docEntry });
    } catch (error) {
      if (error instanceof SapError && error.isPreconditionFailed) {
        return NextResponse.json(
          { error: 'La solicitud cambio mientras la editaba (posiblemente en SAPSEND). Recargue e intente de nuevo.' },
          { status: 409 }
        );
      }
      throw error;
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    return sapErrorResponse(error, 'Error editando solicitud de compra:');
  }
}
