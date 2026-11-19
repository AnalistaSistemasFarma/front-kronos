'use client';

import { Button, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowsSort, IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import { useCallback } from 'react';
import { useUiPreference } from '../../ui/useUiPreference';
import { requestSortKey, type RequestSortList } from '../../../lib/ui/preferences';
import { nextDueSort, parseDueSort, type DueSort, type InboxSlaState } from '../../../lib/requests-general/slaInbox';
import type { RequestSlaInfo } from './useSlaSummary';
import { SlaBadge } from './SlaBadge';

const SORT_HINT: Record<DueSort, string> = {
  none: 'Ordenar por vencimiento (lo más vencido primero)',
  due_asc: 'Lo más vencido primero · toque para invertir',
  due_desc: 'Lo que más tiempo tiene primero · toque para quitar el orden',
};

const SortIcon = ({ sort, size = 14 }: { sort: DueSort; size?: number }) =>
  sort === 'due_asc' ? (
    <IconSortAscending size={size} />
  ) : sort === 'due_desc' ? (
    <IconSortDescending size={size} />
  ) : (
    <IconArrowsSort size={size} style={{ opacity: 0.55 }} />
  );

/** «Vencimiento» sort of a request list, saved per user (dbo.user_ui_preference). */
export function useDueSort(list: RequestSortList) {
  const [raw, setRaw] = useUiPreference<DueSort>(requestSortKey(list), 'none');
  const sort = parseDueSort(raw);
  const cycle = useCallback(() => setRaw(nextDueSort(sort)), [sort, setRaw]);
  return { sort, cycle };
}

/** Clickable «Vencimiento» column header (desktop table). */
export function DueSortHeader({ sort, onCycle }: { sort: DueSort; onCycle: () => void }) {
  return (
    <Tooltip label={SORT_HINT[sort]} withArrow>
      <UnstyledButton
        onClick={onCycle}
        aria-label={`Vencimiento: ${SORT_HINT[sort]}`}
        data-testid='due-sort-header'
        data-sort={sort}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit', fontWeight: 'inherit', color: 'inherit' }}
      >
        Vencimiento
        <SortIcon sort={sort} />
      </UnstyledButton>
    </Tooltip>
  );
}

/** Same control as a compact button, for the phone layout (no table header there). */
export function DueSortButton({ sort, onCycle, size = 'xs' }: { sort: DueSort; onCycle: () => void; size?: 'xs' | 'sm' }) {
  return (
    <Tooltip label={SORT_HINT[sort]} withArrow>
      <Button
        variant={sort === 'none' ? 'light' : 'filled'}
        size={size}
        onClick={onCycle}
        leftSection={<SortIcon sort={sort} />}
        aria-pressed={sort !== 'none'}
        data-testid='due-sort-button'
        data-sort={sort}
      >
        Vencimiento
      </Button>
    </Tooltip>
  );
}

/**
 * «Vencimiento» cell of a row: the remaining-time badge ("Vence en 3 h", "Vencida hace 2 d")
 * when its SLA runs, or a muted «Sin ANS» / «En pausa». Empty for rows that are not pending.
 */
export function DueCell({ state, info }: { state: InboxSlaState | null; info?: RequestSlaInfo }) {
  if (state === 'overdue' || state === 'near_due' || state === 'on_time') return <SlaBadge info={info} />;
  if (state === 'no_sla' || state === 'paused') {
    return (
      <Text size='xs' c='dimmed' data-testid='sla-muted'>
        {state === 'no_sla' ? 'Sin ANS' : 'En pausa'}
      </Text>
    );
  }
  return null;
}
