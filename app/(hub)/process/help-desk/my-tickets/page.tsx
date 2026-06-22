'use client';

import { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Stack, Text } from '@mantine/core';
import { MyTicketsBoard } from '@/components/process/MyTicketsBoard';
import { useHelpDeskAccess } from '@/components/help-desk/hooks/useHelpDeskAccess';
import { getOperatorPanelUrl } from '@/lib/help-desk/subprocessRoles';

function MyTicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { isOperator, loading } = useHelpDeskAccess();

  useEffect(() => {
    if (status === 'loading' || loading) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (isOperator) {
      router.replace(getOperatorPanelUrl());
    }
  }, [session, status, router, isOperator, loading]);

  if (status === 'loading' || loading || !session || isOperator) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Stack align='center' gap='sm'>
          <Text>Cargando...</Text>
        </Stack>
      </div>
    );
  }

  return <MyTicketsBoard />;
}

export default function MyTicketsPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen flex items-center justify-center'>
          <Stack align='center' gap='sm'>
            <Text>Cargando...</Text>
          </Stack>
        </div>
      }
    >
      <MyTicketsPageContent />
    </Suspense>
  );
}
