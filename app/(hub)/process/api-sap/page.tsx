'use client';

import { Container } from '@mantine/core';
import ApiPermissionsPanel from '@/components/administration/api-permissions/ApiPermissionsPanel';

/**
 * API SAP → «Gestión de la API SAP» (2026-11-10). Página del subproceso del mismo nombre: quien lo
 * tenga asignado administra aquí los clientes de la API SAP. El servidor vuelve a
 * validar el permiso en cada consulta (lib/api-permissions/access.ts); sin él, el panel muestra el aviso.
 */
export default function ApiSapPage() {
  return (
    <Container size='xl' py='md'>
      <ApiPermissionsPanel />
    </Container>
  );
}
