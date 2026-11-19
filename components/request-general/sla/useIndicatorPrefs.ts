'use client';

import { useCallback, useMemo } from 'react';
import { useUiPreference } from '../../ui/useUiPreference';
import {
  DEFAULT_INDICATOR_PREFS,
  PREF_REQUEST_INDICATORS,
  normalizeIndicatorPrefs,
  type IndicatorCard,
  type IndicatorPrefs,
} from '../../../lib/ui/preferences';

/** Per-user visibility of the inbox indicator cards (dbo.user_ui_preference). */
export function useIndicatorPrefs() {
  const [raw, setRaw] = useUiPreference<IndicatorPrefs>(PREF_REQUEST_INDICATORS, DEFAULT_INDICATOR_PREFS);
  const prefs = useMemo(() => normalizeIndicatorPrefs(raw), [raw]);
  const isVisible = useCallback((card: IndicatorCard) => !prefs.hiddenCards.includes(card), [prefs]);
  const setCardVisible = useCallback(
    (card: IndicatorCard, visible: boolean) => {
      const rest = prefs.hiddenCards.filter((c) => c !== card);
      setRaw({ ...prefs, hiddenCards: visible ? rest : [...rest, card] });
    },
    [prefs, setRaw],
  );
  const setSlaHidden = useCallback((slaHidden: boolean) => setRaw({ ...prefs, slaHidden }), [prefs, setRaw]);
  return { prefs, isVisible, setCardVisible, setSlaHidden };
}
