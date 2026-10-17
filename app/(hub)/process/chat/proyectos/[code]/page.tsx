import { Suspense } from 'react';
import ProyectosAgente from '../../../../../../components/chat/proyectos/ProyectosAgente';
import { EsqueletoPantallaChat } from '../../../../../../components/chat/ChatSkeletons';

/**
 * PROYECTOS de un asistente — /process/chat/proyectos/<code>. Piloto F1
 * (2026-10-17). El permiso no lo decide la URL: GET /api/chat/projects
 * responde 404 si el asistente no tiene proyectos o la persona no lo ve.
 */
export const dynamic = 'force-dynamic';

export default async function ProyectosAgentePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <Suspense fallback={<EsqueletoPantallaChat />}>
      <ProyectosAgente code={decodeURIComponent(code)} />
    </Suspense>
  );
}
