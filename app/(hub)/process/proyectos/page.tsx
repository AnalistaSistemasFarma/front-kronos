'use client';

import { Suspense } from 'react';
import ProyectosPage from '../../../../components/proyectos/ProyectosPage';

/** Módulo «Proyectos»: espacios de trabajo con asistentes, miembros, archivos y vínculos. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProyectosPage />
    </Suspense>
  );
}
