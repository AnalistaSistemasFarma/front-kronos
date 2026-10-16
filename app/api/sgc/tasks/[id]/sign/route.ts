import { prisma } from '@/lib/prisma';
import { requestOfTask } from '@/lib/sgc/db/requests';
import { signTask } from '@/lib/sgc/db/signatures';
import { sgcSignatureDeps } from '@/lib/sgc/signature/deps';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/tasks/<id>/sign — FIRMA ELECTRÓNICA PROPIA del SGC y
 * aprobación (o envío) de la tarea: { meaning, reason, consentAccepted,
 * password, comment?, checklist?, draftRef, draftSha256 }.
 * La contraseña solo se usa para reautenticar y se descarta: no se guarda ni
 * se registra. Sin contraseña correcta, sin motivo o sin consentimiento no se
 * firma. No llama a Orión.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const { idCompany } = await requestOfTask(prisma, id);
    if (!ctx.access.some((a) => a.idCompany === idCompany && a.canRead)) return jsonNoStore({ error: 'Tarea no encontrada' }, 404);
    const result = await signTask(prisma, sgcSignatureDeps(), id, body, ctx.actor);
    return jsonNoStore(result);
  } catch (error) {
    return errorResponse(error, 'tasks:firmar');
  }
}
