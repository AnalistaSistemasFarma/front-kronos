'use client';

import { use } from 'react';
import SgcRequestView from '../../../../../../components/sgc/tareas/SgcRequestView';

/** Solicitud documental (copia de la vista interna de solicitudes de SynerLink, con capa de datos propia). */
export default function SgcRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SgcRequestView mode='solicitud' id={Number(id)} />;
}
