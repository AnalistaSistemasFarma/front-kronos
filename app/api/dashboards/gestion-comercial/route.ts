import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  accesoGestionComercial,
  getGestionComercialEmpresas,
} from '../../../../lib/dashboards/gestion-comercial/access';
import { parseCorte, iso } from '../../../../lib/dashboards/gestion-comercial/calculo';
import {
  esErrorEsquemaViejo,
  esquemaEnCache,
  guardarEsquema,
  llaveEsquema,
  normalizarLinea,
  type EsquemaVentas,
} from '../../../../lib/dashboards/gestion-comercial/esquema';
import {
  aFila,
  habilesDelMes,
  rangosTablero,
  rutaVistaVentas,
  type Fila,
  type TableroDatos,
} from '../../../../lib/dashboards/gestion-comercial/tablero';
import { sapGet, sapLogin, sapLogout, SapError, type SapSession } from '../../../../lib/sap/serviceLayer';

/**
 * Tablero comercial — datos en vivo de SAP, SOLO LECTURA (GET).
 *
 *   GET                          -> { empresas:[{ id, nombre, lista }] }
 *   GET ?companyId[&corte=AAAA-MM-DD]
 *     -> TableroDatos: líneas compactas de la vista OLP_IND_VentasB1SLQuery para
 *        (1) el mes del corte hasta el corte, (2) el mismo lapso del mes anterior
 *        y (3) el mismo lapso del año anterior. Tres consultas acotadas por fecha,
 *        sin recorrer documentos. La agregación por filtros se hace en la página.
 *        Siempre con $select explícito y detección del esquema de la vista por
 *        empresa y ambiente (lib/dashboards/gestion-comercial/esquema.ts).
 *
 * Acceso: subproceso «Dashboard de gestión comercial»
 * (/process/dashboards/gestion-comercial) asignado al usuario en la empresa.
 * 401 sin sesión; 403 sin permiso; 409 sin Service Layer.
 */

const CAP = 60000;
const VISTA_PREFIJO = 'OLP_IND_VentasB1SLQuery';
const PAGE_SIZE = 1000;
const REINTENTOS = 5;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET de una página con reintentos. La vista OLP_IND_VentasB1SLQuery responde de
 * forma intermitente con error 400/500 («'N° Documento' no es válido» o
 * «Internal server error») y, segundos después, la MISMA consulta responde bien
 * (verificado en OLP el 2026-11-12). Se reintenta la página, no toda la lectura.
 * Errores 401/403 no se reintentan.
 */
async function paginaConReintento<T>(sap: SapSession, path: string): Promise<T> {
  let ultimo: unknown;
  for (let intento = 0; intento < REINTENTOS; intento++) {
    try {
      return await sapGet<T>(sap, path, { Prefer: `odata.maxpagesize=${PAGE_SIZE}` });
    } catch (e) {
      ultimo = e;
      if (e instanceof SapError && (e.status === 401 || e.status === 403)) throw e;
      // Esquema viejo de la vista: no es intermitente, se resuelve con el otro $select.
      if (e instanceof SapError && esErrorEsquemaViejo(e.status, e.friendly)) throw e;
      await espera(400 * (intento + 1));
    }
  }
  throw ultimo;
}

/** Lee todas las páginas de la vista para un rango (siguiendo nextLink), con reintento por página. */
async function leer(sap: SapSession, desde: string, hasta: string, esquema: EsquemaVentas): Promise<Fila[]> {
  const out: Fila[] = [];
  let next: string | null = rutaVistaVentas(desde, hasta, esquema);
  while (next && out.length < CAP) {
    const page: { value?: Record<string, unknown>[]; 'odata.nextLink'?: string; '@odata.nextLink'?: string } =
      await paginaConReintento(sap, next);
    for (const l of page.value ?? []) out.push(aFila(normalizarLinea(l), esquema));
    const link = page['@odata.nextLink'] ?? page['odata.nextLink'] ?? null;
    next = link ? link.replace(/^\/+/, '') : null;
    // nextLink de view.svc puede venir relativo a view.svc/ o a /b1s/v1/.
    if (next && !next.startsWith('view.svc/') && next.startsWith(VISTA_PREFIJO)) next = `view.svc/${next}`;
  }
  return out.slice(0, CAP);
}

/**
 * Primera lectura con detección del esquema: usa el de la caché (por empresa y
 * ambiente) o prueba el nuevo; si la vista no tiene `NDocumento`, pasa al viejo.
 */
async function leerDetectando(
  sap: SapSession,
  llave: string,
  desde: string,
  hasta: string
): Promise<{ filas: Fila[]; esquema: EsquemaVentas }> {
  const inicial = esquemaEnCache(llave) ?? 'nuevo';
  try {
    const filas = await leer(sap, desde, hasta, inicial);
    guardarEsquema(llave, inicial);
    return { filas, esquema: inicial };
  } catch (e) {
    if (!(e instanceof SapError) || !esErrorEsquemaViejo(e.status, e.friendly) || inicial === 'viejo') throw e;
    const filas = await leer(sap, desde, hasta, 'viejo');
    guardarEsquema(llave, 'viejo');
    return { filas, esquema: 'viejo' };
  }
}

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
    let filas: Fila[];
    let esquema: EsquemaVentas;
    let filasAnterior: Fila[] = [];
    let filasAnio: Fila[] = [];
    try {
      ({ filas, esquema } = await leerDetectando(
        sap,
        llaveEsquema(acceso.endpoint.baseUrl, acceso.endpoint.companyDB),
        r.actual.desde,
        r.actual.hasta
      ));
      try {
        filasAnterior = await leer(sap, r.anterior.desde, r.anterior.hasta, esquema);
      } catch (e) {
        console.error('Tablero comercial: mes anterior no disponible', e);
        avisos.push('No se pudo leer el mes anterior; los comparativos mensuales quedan vacíos.');
      }
      try {
        filasAnio = await leer(sap, r.anioAnterior.desde, r.anioAnterior.hasta, esquema);
      } catch (e) {
        console.error('Tablero comercial: año anterior no disponible', e);
        avisos.push('No se pudo leer el año anterior; los comparativos anuales quedan vacíos.');
      }
    } finally {
      await sapLogout(sap);
    }
    avisos.push('El número de documento que se muestra es el del asiento contable: la vista de SAP no entrega hoy el número de factura de forma confiable.');
    if (esquema === 'viejo') {
      avisos.push('La vista de ventas de esta empresa está en su versión anterior: línea terapéutica, ciudad y pedidos quedan «No disponible».');
    }
    if (filas.length >= CAP) avisos.push(`Se alcanzó el tope de ${CAP.toLocaleString('es-CO')} líneas; el mes puede estar incompleto.`);

    const habiles = habilesDelMes(corte);
    const datos: TableroDatos = {
      corte: iso(corte),
      actual: r.actual,
      anterior: r.anterior,
      anioAnterior: r.anioAnterior,
      diasHabilesMes: habiles.mes,
      diasHabilesTranscurridos: habiles.transcurridos,
      actualizado: new Date().toISOString(),
      filas,
      filasAnterior,
      filasAnio,
      avisos,
      esquema,
    };
    return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SapError) {
      console.error('Tablero comercial: error de SAP', error.status, error.friendly);
      const msg =
        error.status >= 500
          ? 'La vista de ventas de SAP (OLP_IND_VentasB1SLQuery) no responde en este ambiente. Intente de nuevo en unos minutos; si persiste, hay que refrescar la vista en el Service Layer.'
          : error.friendly;
      return NextResponse.json({ error: msg }, { status: error.status });
    }
    console.error('Error en tablero comercial:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
