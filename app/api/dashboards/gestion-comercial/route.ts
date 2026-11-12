import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  accesoGestionComercial,
  getGestionComercialEmpresas,
} from '../../../../lib/dashboards/gestion-comercial/access';
import { parseCorte, iso } from '../../../../lib/dashboards/gestion-comercial/calculo';
import type { LineaVenta } from '../../../../lib/dashboards/gestion-comercial/lineas';
import {
  aFila,
  filasDesdeCabeceras,
  habilesDelMes,
  rangosTablero,
  rutaVistaPagina,
  type Cabecera,
  type Fila,
  type TableroDatos,
} from '../../../../lib/dashboards/gestion-comercial/tablero';
import { sapGet, sapGetAll, sapLogin, sapLogout, SapError, type SapSession } from '../../../../lib/sap/serviceLayer';

/**
 * Tablero comercial — datos en vivo de SAP, SOLO LECTURA (GET).
 *
 *   GET                          -> { empresas:[{ id, nombre, lista }] }
 *   GET ?companyId[&corte=AAAA-MM-DD]
 *     -> TableroDatos con tres ventanas: mes del corte, mismo lapso del mes
 *        anterior y del año anterior.
 *
 * Fuente principal: vista OLP_IND_VentasB1SLQuery (detalle por línea), leída con
 * paginación explícita $top/$skip (sin encabezado Prefer ni nextLink, que es la
 * forma en que la vista responde de manera estable) y reintentos por página.
 *
 * Plan B por ventana: si la vista falla, esa ventana se arma con las cabeceras
 * de Invoices / CreditNotes (la misma fuente del dashboard de venta diaria) y se
 * avisa en pantalla. Así una falla de la vista nunca deja el tablero en blanco.
 *
 * Acceso: subproceso «Dashboard de gestión comercial». 401 sin sesión; 403 sin
 * permiso; 409 sin Service Layer.
 */

const CAP = 60000;
const TOP = 200;
const REINTENTOS = 3;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function paginaVista(sap: SapSession, path: string): Promise<LineaVenta[]> {
  let ultimo: unknown;
  for (let intento = 0; intento < REINTENTOS; intento++) {
    try {
      const page = await sapGet<{ value?: LineaVenta[] }>(sap, path);
      return page.value ?? [];
    } catch (e) {
      ultimo = e;
      if (e instanceof SapError && (e.status === 401 || e.status === 403)) throw e;
      await espera(500 * (intento + 1));
    }
  }
  throw ultimo;
}

/** Lee la vista para un rango con $top/$skip hasta que una página venga incompleta. */
async function leerVista(sap: SapSession, desde: string, hasta: string): Promise<Fila[]> {
  const out: Fila[] = [];
  for (let skip = 0; skip < CAP; skip += TOP) {
    const lineas = await paginaVista(sap, rutaVistaPagina(desde, hasta, TOP, skip));
    for (const l of lineas) out.push(aFila(l));
    if (lineas.length < TOP) break;
  }
  return out;
}

const rutaCab = (entidad: 'Invoices' | 'CreditNotes', desde: string, hasta: string) =>
  `${entidad}?$select=DocNum,DocDate,DocTotal,VatSum,CardCode,CardName,SalesPersonCode,Cancelled` +
  `&$filter=DocDate ge '${desde}' and DocDate le '${hasta}'`;

async function leerCabeceras(sap: SapSession, desde: string, hasta: string, vendedores: Map<number, string>): Promise<Fila[]> {
  const facturas = await sapGetAll<Cabecera>(sap, rutaCab('Invoices', desde, hasta), { cap: 30000 });
  const notas = await sapGetAll<Cabecera>(sap, rutaCab('CreditNotes', desde, hasta), { cap: 30000 });
  return filasDesdeCabeceras(facturas, notas, vendedores);
}

const detalle = (e: unknown) =>
  e instanceof SapError ? `SAP ${e.status}: ${e.friendly}` : e instanceof Error ? e.message : String(e);

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const email = session.user.email;

    const sp = new URL(request.url).searchParams;
    const companyParam = sp.get('companyId');

    if (!companyParam) {
      const empresas = await getGestionComercialEmpresas(email);
      if (empresas.length === 0) {
        return NextResponse.json({ error: 'No tiene acceso a este tablero.' }, { status: 403 });
      }
      return NextResponse.json({ empresas }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const companyId = Number(companyParam);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'Empresa inválida' }, { status: 400 });
    }

    const acceso = await accesoGestionComercial(email, companyId);
    if (!acceso.permitido) {
      return NextResponse.json({ error: 'No tiene acceso a este tablero en esta empresa.' }, { status: 403 });
    }
    if (!acceso.endpoint) {
      return NextResponse.json({ error: 'La empresa no tiene Service Layer de SAP configurado.' }, { status: 409 });
    }

    const corte = parseCorte(sp.get('corte'));
    if (!corte) return NextResponse.json({ error: 'Corte inválido' }, { status: 400 });

    const r = rangosTablero(corte);
    const avisos: string[] = [];
    const sap = await sapLogin(acceso.endpoint);
    const ventanas: Record<'actual' | 'anterior' | 'anio', Fila[]> = { actual: [], anterior: [], anio: [] };
    try {
      let vendedores: Map<number, string> | null = null;
      const nombres = async () => {
        if (vendedores) return vendedores;
        const lista = await sapGetAll<{ SalesEmployeeCode?: number; SalesEmployeeName?: string }>(
          sap,
          `SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName`,
          { cap: 5000 }
        );
        vendedores = new Map(lista.map((v) => [Number(v.SalesEmployeeCode), String(v.SalesEmployeeName ?? '').trim()]));
        return vendedores;
      };

      const plan: Array<{ k: 'actual' | 'anterior' | 'anio'; desde: string; hasta: string; nombre: string }> = [
        { k: 'actual', ...r.actual, nombre: 'mes actual' },
        { k: 'anterior', ...r.anterior, nombre: 'mes anterior' },
        { k: 'anio', ...r.anioAnterior, nombre: 'año anterior' },
      ];
      for (const v of plan) {
        try {
          ventanas[v.k] = await leerVista(sap, v.desde, v.hasta);
        } catch (eVista) {
          console.error(`Tablero comercial: vista falló (${v.nombre})`, eVista);
          try {
            ventanas[v.k] = await leerCabeceras(sap, v.desde, v.hasta, await nombres());
            avisos.push(
              `La vista de líneas de SAP no respondió para el ${v.nombre} (${detalle(eVista)}). ` +
                'Se muestran los totales por factura; el detalle por producto, línea terapéutica y ciudad no está disponible en ese periodo.'
            );
          } catch (eCab) {
            console.error(`Tablero comercial: cabeceras fallaron (${v.nombre})`, eCab);
            if (v.k === 'actual') throw eCab;
            avisos.push(`No se pudo leer el ${v.nombre} (${detalle(eCab)}); sus comparativos quedan vacíos.`);
          }
        }
      }
    } finally {
      await sapLogout(sap);
    }

    const habiles = habilesDelMes(corte);
    const datos: TableroDatos = {
      corte: iso(corte),
      actual: r.actual,
      anterior: r.anterior,
      anioAnterior: r.anioAnterior,
      diasHabilesMes: habiles.mes,
      diasHabilesTranscurridos: habiles.transcurridos,
      actualizado: new Date().toISOString(),
      filas: ventanas.actual,
      filasAnterior: ventanas.anterior,
      filasAnio: ventanas.anio,
      avisos,
    };
    return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error en tablero comercial:', error);
    const msg = `No se pudo cargar el tablero. Detalle: ${detalle(error)}`;
    const status = error instanceof SapError && error.status >= 400 && error.status < 600 ? error.status : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
