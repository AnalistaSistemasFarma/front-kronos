import sql from 'mssql';
import { NextResponse } from 'next/server';
import { requireDashboardAdminApi } from '../../../../lib/dashboard/dashboardAccess';
import { getPool } from '../../../../lib/mssqlPool';
import dbconfig from '../../../../dbconfig';
import { prisma } from '../../../../lib/prisma';

const resolveConnection = dbconfig.resolveConnection as () => {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

/**
 * GET /api/health/database
 * Verifica que Prisma y mssql apunten a la misma base de datos.
 */
export async function GET() {
  const auth = await requireDashboardAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const configured = resolveConnection();
    const pool = await getPool();
    const live = await pool.request().query('SELECT DB_NAME() AS database_name');
    const connectedDb = live.recordset[0]?.database_name as string | undefined;

    const prismaMeta = await prisma.$queryRaw<{ database_name: string }[]>`
      SELECT DB_NAME() AS database_name
    `;
    const prismaDb = prismaMeta[0]?.database_name;

    const match = configured.database === connectedDb && connectedDb === prismaDb;

    return NextResponse.json({
      success: true,
      server: configured.server,
      configured_database: configured.database,
      mssql_live_database: connectedDb ?? null,
      prisma_live_database: prismaDb ?? null,
      databases_match: match,
    });
  } catch (error) {
    console.error('Error en health/database:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error al verificar la base de datos',
      },
      { status: 500 }
    );
  }
}
