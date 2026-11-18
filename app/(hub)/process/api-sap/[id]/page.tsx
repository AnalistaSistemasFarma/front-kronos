'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import ApiClientPage from '@/components/administration/api-permissions/ApiClientPage';

/**
 * API SAP → cliente de API en pantalla completa (2026-11-11). /process/api-sap/12 edita;
 * /process/api-sap/nuevo?tipo=agente crea. El servidor valida el permiso «Gestión de la API SAP».
 */
function ClientScreen({ id }: { id: string }) {
  const searchParams = useSearchParams();
  return <ApiClientPage clientParam={id} initialType={searchParams.get('tipo')} />;
}

export default function ApiSapClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <ClientScreen id={id} />
    </Suspense>
  );
}
