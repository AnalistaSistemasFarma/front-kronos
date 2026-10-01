'use client';

import { Stack, Tabs } from '@mantine/core';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import SgcReviewCalendar, { type SgcCalendarResponse } from '../../../../../components/sgc/vencimientos/SgcReviewCalendar';
import { SgcAlertConfigPanel, SgcAlertLogPanel, SgcIcalCard } from '../../../../../components/sgc/vencimientos/SgcAlertsAdmin';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * Vencimientos del SGC (Sprint 5): calendario (mensual, semanal, agenda),
 * suscripción iCal y, para Calidad, configuración de avisos y su registro.
 */
function Vencimientos({ company }: { company: SgcCompanyAccess }) {
  const cal = useSgcFetch<SgcCalendarResponse>(company.canQuality ? `/api/sgc/review-calendar?company=${company.idCompany}` : null);
  return (
    <Tabs defaultValue='calendario' keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab value='calendario'>Calendario</Tabs.Tab>
        {company.canQuality && <Tabs.Tab value='config' data-testid='sgc-tab-avisos'>Avisos (Calidad)</Tabs.Tab>}
        {company.canQuality && <Tabs.Tab value='registro' data-testid='sgc-tab-registro'>Registro de avisos</Tabs.Tab>}
        <Tabs.Tab value='outlook'>Outlook</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value='calendario'>
        <SgcReviewCalendar company={company} />
      </Tabs.Panel>
      {company.canQuality && (
        <Tabs.Panel value='config'>
          <SgcAlertConfigPanel company={company} calendar={cal.data} />
        </Tabs.Panel>
      )}
      {company.canQuality && (
        <Tabs.Panel value='registro'>
          <SgcAlertLogPanel company={company} />
        </Tabs.Panel>
      )}
      <Tabs.Panel value='outlook'>
        <Stack>
          <SgcIcalCard company={company} />
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

export default function SgcVencimientosPage() {
  return (
    <SgcShell section='Calendario de vencimientos' subtitle='Próxima fecha de vencimiento de la vigencia de cada documento, con avisos anticipados.'>
      {(company) => <Vencimientos company={company} />}
    </SgcShell>
  );
}
