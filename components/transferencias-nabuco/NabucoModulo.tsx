'use client';

import { useState } from 'react';
import { Tabs } from '@mantine/core';
import { IconHistory, IconLayoutDashboard, IconSettings } from '@tabler/icons-react';
import type { NabucoCompany } from './client';
import NabucoTablero from './NabucoTablero';
import NabucoConfiguracion from './NabucoConfiguracion';
import NabucoCorridas from './NabucoCorridas';

/** Pestañas del módulo: Tablero, Configuración (solo administradores) y Corridas. */
export default function NabucoModulo({ company, inicial = 'tablero' }: { company: NabucoCompany; inicial?: string }) {
  const [tab, setTab] = useState<string | null>(inicial);
  return (
    <Tabs value={tab} onChange={setTab} keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab value='tablero' leftSection={<IconLayoutDashboard size={16} />}>
          Tablero
        </Tabs.Tab>
        {company.canAdministrar && (
          <Tabs.Tab value='configuracion' leftSection={<IconSettings size={16} />}>
            Configuración
          </Tabs.Tab>
        )}
        <Tabs.Tab value='corridas' leftSection={<IconHistory size={16} />}>
          Corridas
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value='tablero'>
        <NabucoTablero company={company} />
      </Tabs.Panel>
      {company.canAdministrar && (
        <Tabs.Panel value='configuracion'>
          <NabucoConfiguracion company={company} />
        </Tabs.Panel>
      )}
      <Tabs.Panel value='corridas'>
        <NabucoCorridas company={company} />
      </Tabs.Panel>
    </Tabs>
  );
}
