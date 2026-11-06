'use client';

import { Suspense } from 'react';
import ConfiguracionProyectos from '../../../../../components/proyectos/ConfiguracionProyectos';

/** Configuración del módulo «Proyectos»: qué asistentes trabajan en proyectos, por empresa (2026-10-20). */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ConfiguracionProyectos />
    </Suspense>
  );
}
