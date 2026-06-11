'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Center, Loader, Text } from '@mantine/core';
import { useDashboardAdmin } from '../../lib/dashboard/DashboardAdminContext';
import { PROCESS_HUB_URL } from '../../lib/navigation/AppSectionContext';

export default function DashboardAdminGate({ children }: { children: ReactNode }) {
  const { isDashboardAdmin, loadingDashboardAdmin } = useDashboardAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!loadingDashboardAdmin && !isDashboardAdmin) {
      router.replace(PROCESS_HUB_URL);
    }
  }, [loadingDashboardAdmin, isDashboardAdmin, router]);

  if (loadingDashboardAdmin) {
    return (
      <Center py='xl' className='min-h-[40vh]'>
        <Loader aria-label='Verificando permisos del dashboard' />
      </Center>
    );
  }

  if (!isDashboardAdmin) {
    return (
      <Center py='xl' className='min-h-[40vh]'>
        <Text c='dimmed' size='sm'>
          Redirigiendo…
        </Text>
      </Center>
    );
  }

  return <>{children}</>;
}
