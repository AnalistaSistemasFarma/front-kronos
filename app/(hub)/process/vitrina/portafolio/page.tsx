'use client';

import { Suspense } from 'react';
import VitrinaShell from '../../../../../components/vitrina/VitrinaShell';
import VitrinaPortafolio from '../../../../../components/vitrina/VitrinaPortafolio';
import { VITRINA_MODULE_NAME, VITRINA_URLS, vitrinaHref } from '../../../../../lib/vitrina/constants';

/** Portafolio: lista densa de presentaciones. */
export default function VitrinaPortafolioPage() {
  return (
    <VitrinaShell
      title='Portafolio'
      subtitle={(c) => `Portafolio completo de ${c.companyName.trim()}`}
      trail={(c) => [{ label: VITRINA_MODULE_NAME, href: vitrinaHref(VITRINA_URLS.inicio, c.idCompany) }]}
    >
      {(company) => (
        <Suspense>
          <VitrinaPortafolio key={company.idCompany} company={company} />
        </Suspense>
      )}
    </VitrinaShell>
  );
}
