import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../../lib/system-metrics/access';
import { readDbLiveDetail, type DbLiveDetail } from '../../../../lib/system-metrics/dbProbe';

/**
 * GET /api/system-metrics/db-live
 *
 * Foto en vivo de SQL Server: conexiones por origen, consultas bloqueadas y las consultas de
 * esta base que más CPU consumen. Son lecturas de vistas del sistema (solo lectura), pero la
 * de consultas pesadas recorre la caché de planes: se guarda 30 s por proceso para que varias
 * personas recargando la pantalla no la repitan.
 */
const CACHE_MS = 30_000;

declare global {
  var __kronosDbLiveCache: { at: number; data: DbLiveDetail } | undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await hasSystemMetricsAccess(session.user.email))) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const cached = globalThis.__kronosDbLiveCache;
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return NextResponse.json({ ...cached.data, cachedAt: new Date(cached.at).toISOString() });
    }

    const data = await withMssqlPool((pool) => readDbLiveDetail(pool));
    const at = Date.now();
    globalThis.__kronosDbLiveCache = { at, data };
    return NextResponse.json({ ...data, cachedAt: new Date(at).toISOString() });
  } catch (error) {
    console.error('Error consultando SQL Server en vivo:', error);
    return NextResponse.json({ error: 'No se pudo consultar SQL Server' }, { status: 500 });
  }
}
