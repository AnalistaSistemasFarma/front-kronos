import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { escapeOData } from '../../../../lib/health-records/records';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import { SAP_SOURCES } from '../../../../lib/requests-general/sapSources';

/**
 * Opciones para un campo de formulario tipo "consulta SAP" (Solicitudes Generales).
 * Devuelve, para una empresa + fuente curada + termino de busqueda, una lista de
 * `{ value, label }` traida en vivo del Service Layer de esa empresa.
 *
 * La empresa se resuelve a su endpoint SAP activo (`sap_endpoints`). El navegador
 * nunca ve credenciales: todo el login/consulta/logout ocurre aqui en el servidor.
 */

interface SapRow {
  [key: string]: unknown;
}

/** Resuelve el endpoint SAP activo de una empresa (fila activa, si no la primera). */
async function getActiveSapEndpoint(companyId: number) {
  const endpoints = await prisma.sap_endpoints.findMany({
    where: { id_company: companyId },
  });
  const ep = endpoints.find((e) => e.is_active) ?? endpoints[0] ?? null;
  if (!ep || !ep.base_url) return null;
  return {
    baseUrl: ep.base_url,
    username: ep.username ?? '',
    password: ep.password ?? '',
    companyDB: ep.client ?? '',
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const source = (searchParams.get('source') ?? '').trim();
    const q = (searchParams.get('q') ?? '').trim();

    if (!companyId) {
      return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    }

    // Whitelist: solo fuentes curadas. Nunca se acepta una entidad arbitraria del cliente.
    const def = SAP_SOURCES[source];
    if (!def) {
      return NextResponse.json({ error: 'Fuente SAP no válida' }, { status: 400 });
    }

    const creds = await getActiveSapEndpoint(companyId);
    if (!creds) {
      return NextResponse.json(
        { error: 'La empresa no tiene un endpoint SAP activo.' },
        { status: 409 }
      );
    }

    // Con menos de 2 caracteres no se consulta (evita traer todo el catalogo).
    if (q.length < 2) {
      return NextResponse.json({ options: [] });
    }

    const sap = await sapLogin(creds);
    try {
      const e = escapeOData(q);
      const searchClause =
        '(' + def.searchFields.map((f) => `contains(${f},'${e}')`).join(' or ') + ')';
      const filter = def.fixedFilter
        ? `${searchClause} and ${def.fixedFilter}`
        : searchClause;
      const select = def.selectFields.join(',');
      const path = `${def.entity}?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=20&$filter=Valid eq 'tYES' and Frozen eq 'tNO'`;

      const data = await sapGet<{ value?: SapRow[] }>(sap, path);
      const options = (data.value ?? []).map((row) => {
        const code = String(row[def.valueField] ?? '');
        const name = String(row[def.labelField] ?? '');
        const display = name ? `${code} - ${name}` : code;
        return { value: display, label: display };
      });
      return NextResponse.json({ options });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error consultando opciones SAP:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
