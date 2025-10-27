'use client';

import { SessionProvider } from 'next-auth/react';
import { MantineProvider } from '@mantine/core';
import { UserProvider } from '../lib/user-context';
import { SapProvider } from '../lib/sap-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider>
      <SessionProvider>
        <UserProvider>
          <SapProvider>{children}</SapProvider>
        </UserProvider>
      </SessionProvider>
    </MantineProvider>
  );
}
