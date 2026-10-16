'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Group, Loader } from '@mantine/core';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcRelationProposals from '../../../../../components/sgc/relations/SgcRelationProposals';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * MAPA DE RELACIONES tipo Obsidian del SGC (Sprint 5). Se carga solo en el
 * navegador (React Flow mide el lienzo con el DOM).
 * Sprint 9: Calidad ve encima «Relacionar documentos» (propuestas por código).
 */
const SgcRelationMap = dynamic(() => import('../../../../../components/sgc/relations/SgcRelationMap'), {
  ssr: false,
  loading: () => (
    <Group justify='center' my='xl'>
      <Loader />
    </Group>
  ),
});

function Relaciones({ company }: { company: SgcCompanyAccess }) {
  const [version, setVersion] = useState(0);
  return (
    <>
      {company.canQuality && <SgcRelationProposals idCompany={company.idCompany} onChanged={() => setVersion((v) => v + 1)} />}
      <SgcRelationMap key={version} company={company} />
    </>
  );
}

export default function SgcRelacionesPage() {
  return (
    <SgcShell section='Mapa de relaciones' subtitle='Documentos conectados: procedimiento padre, formatos, anexos y referencias. Arrastre, acerque y busque por código.'>
      {(company) => <Relaciones company={company} />}
    </SgcShell>
  );
}
