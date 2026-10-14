'use client';

import { use } from 'react';
import { Alert } from '@mantine/core';
import OtShell from '../../../../../../components/bitacora-proceso/OtShell';
import OtInforme from '../../../../../../components/bitacora-proceso/OtInforme';

/** Bitácora de Proceso — informe imprimible (soporte de calidad). */
export default function InformeOrdenTrabajoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden < 1) return <Alert color='red' m='md'>Bitácora no válida.</Alert>;
  return (
    <OtShell compact>
      {(company) => <OtInforme key={company.idCompany} company={company} idOrden={idOrden} />}
    </OtShell>
  );
}
