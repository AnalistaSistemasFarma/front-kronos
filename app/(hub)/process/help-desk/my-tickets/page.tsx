'use client';

import { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Stack, Text } from '@mantine/core';
import { MyTicketsBoard } from '@/components/process/MyTicketsBoard';
import { useHelpDeskAccess } from '@/components/help-desk/hooks/useHelpDeskAccess';

function MyTicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { isRequester, loading } = useHelpDeskAccess();

  useEffect(() => {
    if (status === 'loading' || loading) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (!isRequester) {
      router.replace('/process');
    }
  }, [session, status, router, isRequester, loading]);

  if (status === 'loading' || loading || !session || !isRequester) {
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
