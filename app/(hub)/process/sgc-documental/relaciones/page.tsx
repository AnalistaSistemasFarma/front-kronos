'use client';

import dynamic from 'next/dynamic';
import { Group, Loader } from '@mantine/core';
import SgcShell from '../../../../../components/sgc/SgcShell';

/**
 * MAPA DE RELACIONES tipo Obsidian del SGC (Sprint 5). Se carga solo en el
 * navegador (React Flow mide el lienzo con el DOM).
 */
const SgcRelationMap = dynamic(() => import('../../../../../components/sgc/relations/SgcRelationMap'), {
  ssr: false,
  loading: () => (
    <Group justify='center' my='xl'>
      <Loader />
    </Group>
  ),
});

export default function SgcRelacionesPage() {
  return (
    <SgcShell section='Mapa de relaciones' subtitle='Documentos conectados: procedimiento padre, formatos, anexos y referencias. Arrastre, acerque y busque por código.'>
      {(company) => <SgcRelationMap company={company} />}
    </SgcShell>
  );
}
