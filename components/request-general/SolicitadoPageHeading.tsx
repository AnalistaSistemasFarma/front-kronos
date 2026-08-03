'use client';

import { Text } from '@mantine/core';
import { useSolicitadoData } from './SolicitadoShell';
import { getFilterLabel } from '../../lib/dashboard/dateRange';

/** Solo la línea de fechas (sin sticky). */
export default function SolicitadoPeriodLabel() {
  const { dateFilter, appliedRange } = useSolicitadoData();

  return (
    <Text size='sm' c='dimmed' fw={500} mb='xs'>
      {getFilterLabel(dateFilter)} · {appliedRange}
    </Text>
  );
}
