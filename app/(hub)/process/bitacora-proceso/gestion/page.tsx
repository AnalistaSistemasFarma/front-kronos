'use client';

import OtShell from '../../../../../components/bitacora-proceso/OtShell';
import OtCatalogo from '../../../../../components/bitacora-proceso/OtCatalogo';

/** Bitácora de Proceso — catálogo de actividades (solo supervisor). */
export default function OrdenesTrabajoGestionPage() {
  return (
    <OtShell section='Catálogo de actividades' subtitle='Actividades que el operario marca con un toque' requireManage>
      {(company) => <OtCatalogo key={company.idCompany} company={company} />}
    </OtShell>
  );
}
