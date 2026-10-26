import { redirect } from 'next/navigation';

/**
 * Dirección de la F1 (piloto del 2026-10-17). Proyectos ahora es un módulo
 * propio: los enlaces viejos (y las notificaciones ya enviadas) llevan al
 * mismo proyecto en /process/proyectos/<id>, con la misma conversación.
 */
export const dynamic = 'force-dynamic';

export default async function ProyectoF1({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const numero = Number.parseInt(id, 10);
  if (!Number.isInteger(numero) || numero <= 0) redirect('/process/proyectos');
  const conv = Number(Array.isArray(sp.conversacion) ? sp.conversacion[0] : sp.conversacion);
  redirect(`/process/proyectos/${numero}${Number.isInteger(conv) && conv > 0 ? `?conversacion=${conv}` : ''}`);
}
