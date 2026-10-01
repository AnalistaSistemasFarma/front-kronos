'use client';

import { Suspense } from 'react';
import SgcFlowsList from '../../../../../components/sgc/flujos/SgcFlowsList';

/**
 * Flujos de Trabajo de Documentos (motor genérico de flujos validados; el
 * documental es el primero). Copia congelada de la lista de Flujos de
 * Trabajo de SynerLink; cada fila abre la vista interna /flujos/<id>.
 */
export default function SgcFlowsPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <SgcFlowsList />
    </Suspense>
  );
}
