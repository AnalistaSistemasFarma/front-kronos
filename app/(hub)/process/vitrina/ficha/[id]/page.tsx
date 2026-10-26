'use client';

import { use } from 'react';
import VitrinaShell from '../../../../../../components/vitrina/VitrinaShell';
import VitrinaFicha from '../../../../../../components/vitrina/VitrinaFicha';
import { VITRINA_MODULE_NAME, VITRINA_URLS, vitrinaHref } from '../../../../../../lib/vitrina/constants';

/** Ficha de una presentación: vial y etiqueta primero, datos, registro y documentos vigentes del SGC. */
export default function VitrinaFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <VitrinaShell
      title='Ficha'
      subtitle={(c) => `Presentación de ${c.companyName.trim()}`}
      trail={(c) => [
        { label: VITRINA_MODULE_NAME, href: vitrinaHref(VITRINA_URLS.inicio, c.idCompany) },
        { label: 'Biblioteca', href: vitrinaHref(VITRINA_URLS.biblioteca, c.idCompany) },
      ]}
    >
      {(company) => <VitrinaFicha key={`${company.idCompany}-${id}`} company={company} id={id} />}
    </VitrinaShell>
  );
}
