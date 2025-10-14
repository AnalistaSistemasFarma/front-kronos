'use client';

import { SessionProvider } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { UserProvider } from '../lib/user-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider>
      <SessionProvider>
        <UserProvider>{children}</UserProvider>
      </SessionProvider>
    </MantineProvider>
  );
}
