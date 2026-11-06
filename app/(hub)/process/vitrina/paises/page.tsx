'use client';

import VitrinaShell from '../../../../../components/vitrina/VitrinaShell';
import VitrinaPaises from '../../../../../components/vitrina/VitrinaPaises';
import { VITRINA_MODULE_NAME, VITRINA_URLS, vitrinaHref } from '../../../../../lib/vitrina/constants';

/** Presencia LATAM: lista de países con su número de presentaciones (sin mapa en la fase 1). */
export default function VitrinaPaisesPage() {
  return (
    <VitrinaShell
      title='Presencia LATAM'
      subtitle={(c) => `Países con presentaciones de ${c.companyName.trim()}`}
      trail={(c) => [{ label: VITRINA_MODULE_NAME, href: vitrinaHref(VITRINA_URLS.inicio, c.idCompany) }]}
    >
      {(company) => <VitrinaPaises key={company.idCompany} company={company} />}
    </VitrinaShell>
  );
}
