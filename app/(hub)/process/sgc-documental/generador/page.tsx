'use client';

import { useState } from 'react';
import { Alert, Tabs } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { SgcAvailableTemplates, SgcGeneratedRegister, SgcMyGenerated, SgcTemplatesManagement } from '../../../../../components/sgc/generator/SgcGenerator';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * GENERADOR DE DOCUMENTOS (plantillas aprobadas por Calidad, 2026-10-10):
 * generar desde una plantilla aprobada, ver los documentos generados propios
 * y, para gestión documental y Calidad, configurar las plantillas; Calidad
 * aprueba y consulta el registro de todo lo generado. Ver lib/sgc/generator.ts.
 */
const TABS = ['generar', 'mios', 'plantillas', 'registro'] as const;

function Generador({ company }: { company: SgcCompanyAccess }) {
  const info = useSgcFetch<{ enabled: boolean; canPropose: boolean; canApprove: boolean; canQuality: boolean }>(`/api/sgc/generator?company=${company.idCompany}`);
  const [tab] = useState(() => {
    const q = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
    return (TABS as readonly string[]).includes(q ?? '') ? (q as string) : 'generar';
  });
  if (info.error) return <Alert color='red' icon={<IconAlertTriangle size={18} />}>{info.error}</Alert>;
  if (!info.data) return null;
  if (!info.data.enabled) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Generador de documentos' data-testid='sgc-generador-apagado'>
        El generador de documentos no está habilitado para esta empresa. Lo enciende Aseguramiento de Calidad con TI.
      </Alert>
    );
  }
  return (
    <Tabs defaultValue={tab} keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab value='generar'>Generar</Tabs.Tab>
        <Tabs.Tab value='mios'>Mis documentos</Tabs.Tab>
        {info.data.canPropose && <Tabs.Tab value='plantillas'>Plantillas</Tabs.Tab>}
        {info.data.canQuality && <Tabs.Tab value='registro'>Registro</Tabs.Tab>}
      </Tabs.List>
      <Tabs.Panel value='generar'>
        <SgcAvailableTemplates idCompany={company.idCompany} />
      </Tabs.Panel>
      <Tabs.Panel value='mios'>
        <SgcMyGenerated idCompany={company.idCompany} />
      </Tabs.Panel>
      {info.data.canPropose && (
        <Tabs.Panel value='plantillas'>
          <SgcTemplatesManagement idCompany={company.idCompany} />
        </Tabs.Panel>
      )}
      {info.data.canQuality && (
        <Tabs.Panel value='registro'>
          <SgcGeneratedRegister idCompany={company.idCompany} />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}

export default function GeneradorDocumentosPage() {
  return (
    <SgcShell section='Generador de documentos' subtitle='Documentos generados desde plantillas aprobadas por Calidad, modificando solo los campos permitidos'>
      {(company) => <Generador company={company} />}
    </SgcShell>
  );
}
