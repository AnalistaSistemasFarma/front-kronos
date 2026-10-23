'use client';

import { Suspense } from 'react';
import VitrinaShell from '../../../../../components/vitrina/VitrinaShell';
import VitrinaBiblioteca from '../../../../../components/vitrina/VitrinaBiblioteca';
import { VITRINA_MODULE_NAME, VITRINA_URLS, vitrinaHref } from '../../../../../lib/vitrina/constants';

/** Biblioteca: presentaciones validadas por familia, línea comercial, grupo terapéutico o servicio, con buscador y filtros. */
export default function VitrinaBibliotecaPage() {
  return (
    <VitrinaShell
      title='Biblioteca'
      subtitle={(c) => `Presentaciones de ${c.companyName.trim()} por familia, línea comercial, grupo terapéutico o servicio`}
      trail={(c) => [{ label: VITRINA_MODULE_NAME, href: vitrinaHref(VITRINA_URLS.inicio, c.idCompany) }]}
    >
      {(company) => (
        <Suspense>
          <VitrinaBiblioteca key={company.idCompany} company={company} />
        </Suspense>
      )}
    </VitrinaShell>
  );
}
