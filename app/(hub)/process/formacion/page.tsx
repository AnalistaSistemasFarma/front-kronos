'use client';

import { Suspense } from 'react';
import ModuloFormacion from '../../../../components/formacion/ModuloFormacion';

/**
 * MÓDULO FORMACIÓN — /process/formacion (Nicolás Rivera, 2026-10-26).
 * Ver `components/formacion/ModuloFormacion.tsx`.
 */
export default function PaginaModuloFormacion() {
  // `useSearchParams` exige un límite de Suspense en el build de Next 15.
  return (
    <Suspense fallback={null}>
      <ModuloFormacion />
    </Suspense>
  );
}
