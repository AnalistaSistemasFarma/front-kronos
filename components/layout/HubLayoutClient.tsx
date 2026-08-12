'use client';

import { Suspense } from 'react';
import Header from '../Header';
import AppHubShell from './AppHubShell';
import AiAssistantChatHost from '../ai/AiAssistantChatHost';
import AiRouteContextBridge from '../ai/AiRouteContextBridge';
import { AiAssistantProvider } from '../../lib/ai/AiAssistantContext';
import { AppSectionProvider } from '../../lib/navigation/AppSectionContext';
import { DashboardAdminProvider } from '../../lib/dashboard/DashboardAdminContext';
import { ProcessDataProvider } from '../../lib/process/ProcessDataContext';
import { RequestRoleNavProvider } from '../../lib/request-general/SolicitadoNavContext';

export default function HubLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <DashboardAdminProvider>
      <RequestRoleNavProvider>
        <AppSectionProvider>
          <ProcessDataProvider>
            <AiAssistantProvider>
              <Suspense fallback={null}>
                <AiRouteContextBridge />
              </Suspense>
              <Header />
              <AppHubShell>{children}</AppHubShell>
              <AiAssistantChatHost />
            </AiAssistantProvider>
          </ProcessDataProvider>
        </AppSectionProvider>
      </RequestRoleNavProvider>
    </DashboardAdminProvider>
  );
}
