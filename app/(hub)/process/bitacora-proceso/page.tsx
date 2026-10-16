'use client';

import OtShell from '../../../../components/bitacora-proceso/OtShell';
import OtListado from '../../../../components/bitacora-proceso/OtListado';
import OtPinPropio from '../../../../components/bitacora-proceso/OtPinPropio';

/** Bitácora de Proceso — listado (abiertas y cerradas de los últimos 30 días) y «Configurar PIN de bitácora». */
export default function OrdenesTrabajoPage() {
  return <OtShell actions={() => <OtPinPropio />}>{(company) => <OtListado key={company.idCompany} company={company} />}</OtShell>;
}
