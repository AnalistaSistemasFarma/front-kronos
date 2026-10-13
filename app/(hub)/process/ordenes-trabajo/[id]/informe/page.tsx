'use client';

import { use } from 'react';
import { Alert } from '@mantine/core';
import OtShell from '../../../../../../components/ordenes-trabajo/OtShell';
import OtInforme from '../../../../../../components/ordenes-trabajo/OtInforme';

/** Órdenes de Trabajo — informe imprimible (soporte de calidad). */
export default function InformeOrdenTrabajoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden < 1) return <Alert color='red' m='md'>Orden de trabajo no válida.</Alert>;
  return (
    <OtShell compact>
      {(company) => <OtInforme key={company.idCompany} company={company} idOrden={idOrden} />}
    </OtShell>
  );
}
