import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { userCanAccessCompany } from '../../../../lib/payment-assistant/access';
import {
  getDispersionConfig,
  upsertDispersionConfig,
  type DispersionConfigInput,
} from '../../../../lib/payment-assistant/dispersionConfig';

/**
 * Configuración de dispersión (cabecera DISFON) por empresa del Asistente de
 * Pagos.
 *
 * GET  /api/payment-assistant/dispersion-config?companyId=<id>
 *   → devuelve la configuración actual de la empresa (o null si no existe).
 *
 * POST /api/payment-assistant/dispersion-config   { companyId, ...campos }
 *   → UPSERT (INSERT/UPDATE por id_company) de la configuración.
 *
 * ESCRITURA: la única escritura del módulo, y va SOLO a la tabla propia
 * `payment_dispersion_config` en KRONOSDB_PRUEBAS. NUNCA toca SAP. Ambos verbos
 * validan que el usuario tenga acceso a la empresa (nivel write).
 */

/** Valores permitidos para validar la entrada del formulario. */
const TIPO_CUENTA_VALIDOS = ['1', '2', '5']; // 1 corriente / 2 ahorros / 5 rotativo
const TIPO_ID_VALIDOS = ['N', 'L', 'I']; // N NIT / L cédula / I extranjero

/** Extrae y valida el companyId de un valor crudo. */
function parseCompanyId(raw: unknown): number | null {
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) return null;
  return n;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = parseCompanyId(request.nextUrl.searchParams.get('companyId'));
    if (companyId === null) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    const allowed = await userCanAccessCompany(session.user.email, companyId);
    if (!allowed) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa.' },
        { status: 403 }
      );
    }

    const config = await getDispersionConfig(companyId);
    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error leyendo la configuración de dispersión:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

/** Handler común de escritura para POST y PUT (upsert idéntico). */
async function upsert(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const companyId = parseCompanyId((body as Record<string, unknown>).companyId);
    if (companyId === null) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    const allowed = await userCanAccessCompany(session.user.email, companyId);
    if (!allowed) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa.' },
        { status: 403 }
      );
    }

    const b = body as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const cuentaDispersora = str(b.cuentaDispersora);
    const nit = str(b.nit);
    const tipoCuenta = str(b.tipoCuenta) || '1';
    const tipoMovimiento = str(b.tipoMovimiento) || '002';
    const codigoCiudad = str(b.codigoCiudad) || '0000';
    const codigoOficina = str(b.codigoOficina) || '000';
    const tipoId = (str(b.tipoId) || 'N').toUpperCase();
    const nombreEmpresaRaw = str(b.nombreEmpresa);
    const nombreEmpresa = nombreEmpresaRaw === '' ? null : nombreEmpresaRaw;

    // Validaciones de campos obligatorios y dominios.
    const errors: string[] = [];
    if (!cuentaDispersora) errors.push('La cuenta dispersora es obligatoria.');
    if (!nit) errors.push('El NIT es obligatorio.');
    if (!TIPO_CUENTA_VALIDOS.includes(tipoCuenta)) {
      errors.push('El tipo de cuenta debe ser 1 (corriente), 2 (ahorros) o 5 (rotativo).');
    }
    if (!TIPO_ID_VALIDOS.includes(tipoId)) {
      errors.push('El tipo de identificación debe ser N, L o I.');
    }
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
    }

    const input: DispersionConfigInput = {
      cuentaDispersora,
      tipoCuenta,
      nit,
      tipoMovimiento,
      codigoCiudad,
      codigoOficina,
      tipoId,
      nombreEmpresa,
    };

    const config = await upsertDispersionConfig(companyId, input);
    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error guardando la configuración de dispersión:', error);
    return NextResponse.json({ error: 'Error interno al guardar' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return upsert(request);
}

export async function PUT(request: NextRequest) {
  return upsert(request);
}
