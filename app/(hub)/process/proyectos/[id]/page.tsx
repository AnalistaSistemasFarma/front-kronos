import { Suspense } from 'react';
import ProyectoPage from '../../../../../components/proyectos/ProyectoPage';

/**
 * Un proyecto del módulo «Proyectos». El permiso nunca lo decide la URL:
 * GET /api/proyectos/<id> responde 404 si la persona no es miembro.
 */
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numero = Number.parseInt(id, 10);
  return (
    <Suspense fallback={null}>
      <ProyectoPage idProject={Number.isInteger(numero) && numero > 0 ? numero : 0} />
    </Suspense>
  );
}
