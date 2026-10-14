'use client';

import OtShell from '../../../../components/bitacora-proceso/OtShell';
import OtListado from '../../../../components/bitacora-proceso/OtListado';

/** Bitácora de Proceso — listado (abiertas y cerradas de los últimos 30 días). */
export default function OrdenesTrabajoPage() {
  return <OtShell>{(company) => <OtListado key={company.idCompany} company={company} />}</OtShell>;
}
