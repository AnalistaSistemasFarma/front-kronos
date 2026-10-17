import { Suspense } from 'react';
import ProyectoWorkspace from '../../../../../../components/chat/proyectos/ProyectoWorkspace';
import { EsqueletoPantallaChat } from '../../../../../../components/chat/ChatSkeletons';

/**
 * UN PROYECTO abierto — /process/chat/proyecto/<id>. Piloto F1 (2026-10-17).
 * Un id que no sea suyo responde 404 en el servidor (lib/chat/projects.ts):
 * el permiso nunca lo decide la URL.
 */
export const dynamic = 'force-dynamic';

export default async function ProyectoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numero = Number.parseInt(id, 10);
  return (
    <Suspense fallback={<EsqueletoPantallaChat />}>
      <ProyectoWorkspace idProject={Number.isInteger(numero) && numero > 0 ? numero : 0} />
    </Suspense>
  );
}
