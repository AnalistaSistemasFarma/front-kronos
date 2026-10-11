'use client';

import { use } from 'react';
import SgcShell from '../../../../../../components/sgc/SgcShell';
import SgcGeneratorEditor from '../../../../../../components/sgc/generator/SgcGeneratorEditor';

/** Generador de documentos: copia de trabajo de un documento vigente (ver lib/sgc/generator.ts). */
export default function SgcGeneradorDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SgcShell section='Generador de documentos' subtitle='Copia de trabajo de un documento vigente: modifíquela y genere el PDF'>
      {(company) => <SgcGeneratorEditor company={company} idDocument={Number(id)} />}
    </SgcShell>
  );
}
