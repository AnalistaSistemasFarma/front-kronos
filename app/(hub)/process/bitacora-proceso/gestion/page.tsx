'use client';

import OtShell from '../../../../../components/bitacora-proceso/OtShell';
import OtCatalogo from '../../../../../components/bitacora-proceso/OtCatalogo';

/** Bitácora de Proceso — catálogo: actividades, operarios y áreas (solo supervisor). */
export default function OrdenesTrabajoGestionPage() {
  return (
    <OtShell section='Catálogo' subtitle='Actividades, operarios y áreas de la bitácora' requireManage>
      {(company) => <OtCatalogo key={company.idCompany} company={company} />}
    </OtShell>
  );
}
