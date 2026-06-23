'use client';

import { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Stack, Text } from '@mantine/core';
import { MyTicketsBoard } from '@/components/process/MyTicketsBoard';
import { hasAdminRole } from '@/lib/access-control';

function MyTicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (hasAdminRole(session.user?.role)) {
      router.replace('/process/help-desk/create-ticket');
    }
  }, [session, status, router]);

  if (status === 'loading' || !session || hasAdminRole(session.user?.role)) {
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
