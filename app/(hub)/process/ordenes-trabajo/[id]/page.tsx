'use client';

import { use } from 'react';
import { Alert } from '@mantine/core';
import OtShell from '../../../../../components/ordenes-trabajo/OtShell';
import OtPlanta from '../../../../../components/ordenes-trabajo/OtPlanta';

/** Órdenes de Trabajo — pantalla de planta (registro de intervenciones). */
export default function OrdenTrabajoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden < 1) return <Alert color='red' m='md'>Orden de trabajo no válida.</Alert>;
  return (
    <OtShell compact>
      {(company) => <OtPlanta key={company.idCompany} company={company} idOrden={idOrden} />}
    </OtShell>
  );
}
