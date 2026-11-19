'use client';

import { Badge, Tooltip } from '@mantine/core';
import { formatRemaining } from '../../../lib/requests-general/sla';
import type { InboxSlaState } from '../../../lib/requests-general/slaInbox';
import type { RequestSlaInfo } from './useSlaSummary';

const COLOR = { overdue: 'red', near_due: 'yellow', on_time: 'green' } as const;

/** Small per-request SLA badge for the lists ("Vence en 3 h", "Vencida hace 2 d"). */
export function SlaBadge({ info }: { info?: RequestSlaInfo }) {
  if (!info || info.state === 'no_sla') return null;
  return (
    <Tooltip label={`ANS del subproceso: ${info.slaLabel}`} withArrow>
      <Badge
        size='xs'
        variant='light'
        color={COLOR[info.state]}
        data-testid='sla-badge'
        styles={{ label: { overflow: 'visible' } }}
      >
        {formatRemaining(info.remainingHours)}
      </Badge>
    </Tooltip>
  );
}

/**
 * Due label of a list row, under its status badge (as in #1040): shown only while the row's
 * SLA clock runs. A task row carries the clock of its request.
 */
export function DueBadge({ state, info }: { state: InboxSlaState | null; info?: RequestSlaInfo }) {
  return state === 'overdue' || state === 'near_due' || state === 'on_time' ? <SlaBadge info={info} /> : null;
}
