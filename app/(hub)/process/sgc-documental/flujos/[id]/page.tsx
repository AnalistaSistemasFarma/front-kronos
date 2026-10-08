'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import SgcFlowView from '../../../../../../components/sgc/flujos/SgcFlowView';

/**
 * Vista interna de un flujo de Documentos (copia congelada de view-workflows
 * de SynerLink). ?version=<n> abre una versión concreta; por defecto, la
 * vigente (o el borrador si aún no hay vigente).
 */
function FlowPage() {
  const params = useParams<{ id: string }>();
  return <SgcFlowView idFlowProcess={Number(params.id)} />;
}

export default function SgcFlowPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <FlowPage />
    </Suspense>
  );
}
