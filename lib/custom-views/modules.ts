/**
 * Resolución del MÓDULO de primer nivel (`process`) donde se ubica una vista.
 *
 * Una vista publicada cuelga su subproceso de un módulo de primer nivel (fila de
 * la tabla `process`). El autor puede:
 *   - elegir un módulo EXISTENTE (`targetProcessId`), o
 *   - crear uno NUEVO por nombre (`newCategoryName`), o
 *   - no elegir nada → módulo por defecto "Vistas personalizadas" (id 13).
 *
 * La tabla `process` sólo tiene: id_process, process (nombre), process_url. Un
 * módulo NUEVO se crea como CONTENEDOR con process_url = null (igual que módulos
 * existentes tipo "Gestión de Procesos"): el ítem de primer nivel agrupa y sus
 * vistas cuelgan como subprocesos navegables (subprocess_url =
 * /process/custom-views/v/<slug>). Se rendea en el menú (GET /api/processes) para
 * quien tenga asignado alguno de esos subprocesos; el icono/orden del menú son
 * derivados en el front (fallback 📊 y orden alfabético), no columnas de la tabla.
 */

import type { PrismaClient } from '../../app/generated/prisma';
import { CUSTOM_VIEWS_PROCESS_ID } from './access';

export interface ModuleSelection {
  /** id de un módulo existente (tabla process). */
  targetProcessId?: unknown;
  /** nombre de un módulo NUEVO a crear (si no se elige uno existente). */
  newCategoryName?: unknown;
}

/** Limpia el nombre de un módulo nuevo (trim + colapsa espacios). Puede ser ''. */
export function cleanModuleName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/** Parsea un id de módulo entero positivo, o null si no es válido. */
export function parseModuleId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resuelve el id_process destino a partir de la selección del autor:
 *  1) si `newCategoryName` no está vacío → busca un módulo con ESE nombre
 *     (case-insensitive por comparación exacta tras trim); si no existe, lo crea
 *     (idempotente por nombre). Devuelve su id.
 *  2) si `targetProcessId` es un id válido y existe → lo usa.
 *  3) en otro caso → CUSTOM_VIEWS_PROCESS_ID (13, "Vistas personalizadas").
 *
 * @throws si `newCategoryName` está vacío pero era la intención (no aplica aquí)
 *         o si `targetProcessId` referencia un módulo inexistente.
 */
export async function resolveModuleProcessId(
  prisma: PrismaClient,
  selection: ModuleSelection
): Promise<number> {
  const newName = cleanModuleName(selection.newCategoryName);
  if (newName) {
    // Idempotente por nombre exacto (evita duplicar módulos).
    const existing = await prisma.process.findFirst({
      where: { process: newName },
      select: { id_process: true },
    });
    if (existing) return existing.id_process;
    const created = await prisma.process.create({
      // Contenedor: sin process_url (las vistas cuelgan como subprocesos).
      data: { process: newName, process_url: null },
      select: { id_process: true },
    });
    return created.id_process;
  }

  const targetId = parseModuleId(selection.targetProcessId);
  if (targetId !== null) {
    const mod = await prisma.process.findUnique({
      where: { id_process: targetId },
      select: { id_process: true },
    });
    if (!mod) {
      throw new Error(`El módulo destino (id ${targetId}) no existe.`);
    }
    return mod.id_process;
  }

  return CUSTOM_VIEWS_PROCESS_ID;
}
