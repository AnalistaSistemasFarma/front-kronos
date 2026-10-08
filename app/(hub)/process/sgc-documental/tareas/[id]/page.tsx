'use client';

import { use } from 'react';
import SgcRequestView from '../../../../../../components/sgc/tareas/SgcRequestView';

/** Tarea documental (copia de la vista de actividad de SynerLink, con capa de datos propia). */
export default function SgcTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SgcRequestView mode='tarea' id={Number(id)} />;
}
