import type { Prisma, PrismaClient } from '../../app/generated/prisma';
import { conPadres, estaDentro } from './carpetas';

/**
 * Persistencia de las CARPETAS de los Archivos del proyecto (2026-11-06).
 * Las reglas de las rutas viven en lib/proyectos/carpetas.ts (puras).
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Asegura que existan la carpeta y todas sus carpetas padre (filas propias en
 * chat_project_folder). Idempotente: si otra carga las creó al mismo tiempo, no falla.
 */
export async function asegurarCarpetas(db: Db, idProject: number, rutas: readonly (string | null)[], userId: string | null): Promise<number> {
  const todas = [...new Set(rutas.flatMap((r) => conPadres(r)))];
  if (todas.length === 0) return 0;
  const existentes = new Set(
    (await db.chatProjectFolder.findMany({ where: { id_project: idProject, path: { in: todas } }, select: { path: true } })).map((f) => f.path)
  );
  let creadas = 0;
  for (const path of todas) {
    if (existentes.has(path)) continue;
    try {
      await db.chatProjectFolder.create({ data: { id_project: idProject, path, created_by: userId } });
      creadas++;
    } catch (error) {
      // P2002: la creó otra carga en paralelo (la ruta es única por proyecto).
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    }
  }
  return creadas;
}

// Se filtra aquí y no con LIKE (startsWith): «_» y «%» son comodines en SQL Server y una carpeta
// «A_B» atraparía a «AxB». Un proyecto tiene a lo sumo MAX_PROJECT_FILES archivos.

/** ¿Hay archivos dentro de la carpeta (en ella o en sus subcarpetas)? */
export async function carpetaTieneArchivos(db: Db, idProject: number, ruta: string): Promise<boolean> {
  const rutas = await db.chatProjectFile.findMany({ where: { id_project: idProject, folder_path: { not: null } }, select: { folder_path: true }, distinct: ['folder_path'] });
  return rutas.some((r) => estaDentro(r.folder_path, ruta));
}

/** Ids de la carpeta y de todas sus subcarpetas. */
export async function carpetasDentro(db: Db, idProject: number, ruta: string): Promise<number[]> {
  const todas = await db.chatProjectFolder.findMany({ where: { id_project: idProject }, select: { id_project_folder: true, path: true } });
  return todas.filter((f) => estaDentro(f.path, ruta)).map((f) => f.id_project_folder);
}
