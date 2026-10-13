'use client';

import OtShell from '../../../../components/ordenes-trabajo/OtShell';
import OtListado from '../../../../components/ordenes-trabajo/OtListado';

/** Órdenes de Trabajo — listado (abiertas y cerradas de los últimos 30 días). */
export default function OrdenesTrabajoPage() {
  return <OtShell>{(company) => <OtListado key={company.idCompany} company={company} />}</OtShell>;
}
