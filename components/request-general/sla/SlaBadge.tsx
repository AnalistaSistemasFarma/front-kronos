'use client';

import { Badge, Tooltip } from '@mantine/core';
import { formatRemaining } from '../../../lib/requests-general/sla';
import type { RequestSlaInfo } from './useSlaSummary';

const COLOR = { overdue: 'red', near_due: 'yellow', on_time: 'green' } as const;

/** Small per-request SLA badge for the lists ("Vence en 3 h", "Vencida hace 2 d"). */
export function SlaBadge({ info }: { info?: RequestSlaInfo }) {
  if (!info || info.state === 'no_sla') return null;
  return (
    <Tooltip label={`ANS del subproceso: ${info.slaLabel}`} withArrow>
      <Badge size='xs' variant='light' color={COLOR[info.state]} data-testid='sla-badge'>
        {formatRemaining(info.remainingHours)}
      </Badge>
    </Tooltip>
  );
}
