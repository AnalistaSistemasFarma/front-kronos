import { prisma } from '../../../../../lib/prisma';
import { aplicarCargue, simularCargue } from '../../../../../lib/biomedica/inventario';
import { leerInventarioXlsx, MAX_BYTES_CARGUE } from '../../../../../lib/biomedica/inventarioExcel';
import { errorResponse, jsonNoStore } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MUESTRA = 200;

/**
 * POST multipart: company, file (.xlsx, formato FR-017), modo (simular | aplicar), justificacion?
 * «simular» no escribe nada: dice qué es nuevo, qué cambia, qué filas tienen error y cuántos del
 * inventario no están en el archivo. «aplicar» vuelve a simular y escribe (todo o nada).
 */
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BYTES_CARGUE + 256 * 1024) {
      return jsonNoStore({ error: 'El archivo debe pesar máximo 15 MB.' }, 413);
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const c = await biomedContext(request, form?.get('company'));
    if (c instanceof Response) return c;
    if (!(file instanceof Blob)) return jsonNoStore({ error: 'Cargue el archivo del inventario.' }, 400);
    const { filas, errores, hoja } = await leerInventarioXlsx(new Uint8Array(await file.arrayBuffer()));
    const nombreArchivo = file instanceof File ? file.name : 'inventario.xlsx';
    if (form?.get('modo') === 'aplicar') {
      return jsonNoStore(await aplicarCargue(prisma, c.access, filas, errores, { justificacion: form?.get('justificacion'), nombreArchivo }, c.actor));
    }
    const sim = await simularCargue(prisma, c.access, filas, errores);
    return jsonNoStore({
      hoja,
      leidas: sim.leidas,
      nuevos: sim.nuevos.length,
      cambios: sim.cambios.length,
      iguales: sim.iguales,
      errores: sim.errores.length,
      noEnArchivo: sim.noEnArchivo,
      muestraNuevos: sim.nuevos.slice(0, MUESTRA).map((f) => ({ fila: f.fila, ...f.datos })),
      muestraCambios: sim.cambios.slice(0, MUESTRA),
      muestraErrores: sim.errores.slice(0, MUESTRA),
    });
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:cargue');
  }
}
