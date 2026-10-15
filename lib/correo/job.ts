import 'server-only';
import { prisma } from '../prisma';
import { getCorreoAccess } from './db';
import { correoDeps } from './runtime';
import { sincronizarTodo } from './service';

/**
 * job_type 'correo_sincronizar_hilos' (lib/scheduler/handlers.js): pasa a notas de
 * cada caso los correos nuevos de los hilos vinculados. APAGADO por partida doble:
 * la fila de scheduled_job se siembra inactiva y, aunque se active, no hace nada
 * sin CORREO_SYNC_HABILITADO=true. Lee el buzón del DUEÑO de cada vínculo (app de aplicación,
 * siempre por mailboxForSession con su correo; no necesita offline_access);
 * si una persona perdió el permiso del módulo, su hilo se omite.
 * Payload opcional: { limite } (hilos por corrida, máx. 200).
 */
export async function runCorreoSyncJob(payload?: { limite?: number } | null): Promise<{ ref?: string; detail: string }> {
  const limite = Math.min(200, Math.max(1, Number(payload?.limite) || 50));
  const r = await sincronizarTodo(
    correoDeps(),
    async (idUser) => {
      const u = await prisma.user.findFirst({ where: { id: idUser, isActive: true }, select: { email: true } });
      return u ? getCorreoAccess(prisma, u.email) : null;
    },
    limite
  );
  if (r.omitido) return { detail: `Omitido: ${r.omitido}` };
  return { detail: `${r.hilos} hilo(s) revisados, ${r.agregadas} nota(s) nuevas, ${r.errores} error(es)` };
}
