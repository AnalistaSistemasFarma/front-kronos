'use client';

import { use } from 'react';
import SgcShell from '../../../../../../components/sgc/SgcShell';
import { SgcGenerateForm } from '../../../../../../components/sgc/generator/SgcGenerator';

/** Generar un documento desde una plantilla aprobada por Calidad (ver lib/sgc/generator.ts). */
export default function GenerarDesdePlantillaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SgcShell section='Generador de documentos' subtitle='Llene solo los campos permitidos por Calidad; el resto es el texto aprobado'>
      {(company) => <SgcGenerateForm idCompany={company.idCompany} idTemplate={Number(id)} />}
    </SgcShell>
  );
}
