'use client';

import VitrinaShell from '../../../../components/vitrina/VitrinaShell';
import VitrinaInicio from '../../../../components/vitrina/VitrinaInicio';
import { VITRINA_MODULE_NAME } from '../../../../lib/vitrina/constants';

/** Vitrina Comercial (comerciales): Inicio con accesos y destacadas. Cada comercial ve solo su empresa. */
export default function VitrinaPage() {
  return (
    <VitrinaShell title={VITRINA_MODULE_NAME} subtitle={(c) => `Portafolio comercial de ${c.companyName.trim()}`}>
      {(company) => <VitrinaInicio key={company.idCompany} company={company} />}
    </VitrinaShell>
  );
}
