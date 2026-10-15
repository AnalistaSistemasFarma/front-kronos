'use client';

import { IconCalendar } from '@tabler/icons-react';
import { useSolicitadoData } from './SolicitadoShell';
import { getFilterLabel } from '../../lib/dashboard/dateRange';
import { panelStyles } from '../ui/panel/Panel';

/** Línea de periodo encima del título grande. */
export default function SolicitadoPeriodLabel() {
  const { dateFilter, appliedRange } = useSolicitadoData();

  return (
    <span className={panelStyles.eyebrow}>
      <IconCalendar size={15} stroke={2} />
      {getFilterLabel(dateFilter)} · {appliedRange}
    </span>
  );
}
