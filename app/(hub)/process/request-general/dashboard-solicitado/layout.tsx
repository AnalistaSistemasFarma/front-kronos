'use client';

import type { ReactNode } from 'react';
import { SolicitadoShell } from '../../../../../components/request-general/SolicitadoShell';

export default function SolicitadoLayout({ children }: { children: ReactNode }) {
  return <SolicitadoShell>{children}</SolicitadoShell>;
}
