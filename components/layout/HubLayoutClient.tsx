'use client';

import Header from '../Header';
import AppHubShell from './AppHubShell';
import { AppSectionProvider } from '../../lib/navigation/AppSectionContext';
import { ProcessDataProvider } from '../../lib/process/ProcessDataContext';

export default function HubLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <AppSectionProvider>
      <ProcessDataProvider>
        <Header />
        <AppHubShell>{children}</AppHubShell>
      </ProcessDataProvider>
    </AppSectionProvider>
  );
}
