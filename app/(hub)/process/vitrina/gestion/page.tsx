'use client';

import VitrinaShell from '../../../../../components/vitrina/VitrinaShell';
import VitrinaGestion from '../../../../../components/vitrina/VitrinaGestion';
import { VITRINA_GESTION_NAME } from '../../../../../lib/vitrina/constants';

/** Vitrina Comercial · Gestión: bandeja de SAP, presentaciones, exclusividades, alertas, áreas e historial. */
export default function VitrinaGestionPage() {
  return (
    <VitrinaShell
      title={VITRINA_GESTION_NAME}
      subtitle={(c) => `Artículos de SAP, presentaciones y exclusividades de ${c.companyName.trim()}`}
      requireGestion
    >
      {(company) => <VitrinaGestion key={company.idCompany} company={company} />}
    </VitrinaShell>
  );
}
