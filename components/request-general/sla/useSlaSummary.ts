'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SlaState } from '../../../lib/requests-general/sla';
import type { InboxSlaBreakdown, InboxSlaCounts } from '../../../lib/requests-general/slaInbox';

export interface RequestSlaInfo {
  state: SlaState;
  remainingHours: number | null;
  slaHours: number | null;
  slaLabel: string;
}

export interface SlaSummary {
  available: boolean;
  /** Pending inbox rows (requests + tasks) per bucket; they add up to `total`. */
  counts: InboxSlaCounts;
  breakdown: InboxSlaBreakdown;
  total: number;
  byRequest: Record<number, RequestSlaInfo>;
}

/** SLA (ANS) of the user's assigned-requests inbox. `refreshKey` reloads it. */
export function useSlaSummary(refreshKey: unknown = null) {
  const [data, setData] = useState<SlaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/requests-general/sla-summary', { cache: 'no-store' });
      if (res.ok) setData((await res.json()) as SlaSummary);
    } catch {
      // The widget is informative: on failure the page keeps working without it.
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return { data, loading, reload: load };
}
