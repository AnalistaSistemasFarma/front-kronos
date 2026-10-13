'use client';

import OtShell from '../../../../../components/ordenes-trabajo/OtShell';
import OtCatalogo from '../../../../../components/ordenes-trabajo/OtCatalogo';

/** Órdenes de Trabajo — catálogo de actividades (solo supervisor). */
export default function OrdenesTrabajoGestionPage() {
  return (
    <OtShell section='Catálogo de actividades' subtitle='Actividades que el operario marca con un toque' requireManage>
      {(company) => <OtCatalogo key={company.idCompany} company={company} />}
    </OtShell>
  );
}
