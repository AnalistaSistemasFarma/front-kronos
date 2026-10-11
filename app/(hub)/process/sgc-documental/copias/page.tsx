'use client';

import { useState } from 'react';
import { Card, Tabs } from '@mantine/core';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { SgcCopiesQuality, SgcCopyRequestForm, SgcMyCopies } from '../../../../../components/sgc/SgcUncontrolledCopies';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * COPIAS NO CONTROLADAS (Sprint 11): pedir una copia, ver las propias
 * (imprimir mientras esté vigente) y, para el grupo exclusivo de Calidad,
 * decidir y consultar el historial y el reporte.
 */
function Copias({ company }: { company: SgcCompanyAccess }) {
  const [version, setVersion] = useState(0);
  const [prefill] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('documento')));
  return (
    <Tabs defaultValue={prefill ? 'solicitar' : 'mias'} keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab value='mias'>Mis copias</Tabs.Tab>
        <Tabs.Tab value='solicitar'>Solicitar copia</Tabs.Tab>
        <Tabs.Tab value='calidad'>Calidad</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value='mias'>
        <SgcMyCopies key={version} idCompany={company.idCompany} />
      </Tabs.Panel>
      <Tabs.Panel value='solicitar'>
        <Card withBorder radius='md' p='lg'>
          <SgcCopyRequestForm idCompany={company.idCompany} initialDocument={prefill} onDone={() => setVersion((v) => v + 1)} />
        </Card>
      </Tabs.Panel>
      <Tabs.Panel value='calidad'>
        <SgcCopiesQuality idCompany={company.idCompany} />
      </Tabs.Panel>
    </Tabs>
  );
}

export default function CopiasNoControladasPage() {
  return (
    <SgcShell section='Copias no controladas' subtitle='Copias que salen de la compañía o se diligencian a mano, autorizadas por Calidad, con marca y vencimiento'>
      {(company) => <Copias company={company} />}
    </SgcShell>
  );
}
