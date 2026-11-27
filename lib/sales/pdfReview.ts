import { CONFIDENCE_LABEL, type Confidence } from './itemPrediction';

/**
 * Review rules of the PDF offer simulation (Nicolás Rivera, 2026-11-27): no per-line confirmation. Every line
 * with a suggested item goes to the offer; Media/Baja lines are only highlighted. Only lines WITHOUT an item
 * block the Agregar a la oferta button (the user picks one or unchecks the line).
 */
type ReviewLine = Record<string, unknown> & { include?: boolean };
type ReviewMatch = { confidence: Confidence; reason: string; autoSelected: boolean; confirmed?: boolean };

const matchOf = (l: ReviewLine) => (l.match ?? null) as ReviewMatch | null;

/** A line can go to the offer when it has an item. */
export const lineReady = (l: ReviewLine): boolean => Boolean(l.ItemCode);

/** Included lines that still block the offer (no item). */
export const blockingLines = (lines: ReviewLine[]): number => lines.filter((l) => l.include && !lineReady(l)).length;

/** Indexes of the included lines with an item and low (Baja) confidence, to review them at a glance. */
export const lowConfidenceIndexes = (lines: ReviewLine[]): number[] =>
  lines.flatMap((l, i) => (l.include && lineReady(l) && matchOf(l)?.confidence === 'baja' ? [i] : []));

/** Agregar a la oferta is enabled: at least one line included and none of the included lines lacks an item. */
export const canApply = (lines: ReviewLine[]): boolean => lines.some((l) => l.include) && blockingLines(lines) === 0;

/**
 * AI note that travels with the offer line: the prediction label (Alta, Media, Baja), or "Elegido" when the user
 * picked the item by hand on a line that was not auto-selected.
 */
export const offerAiNote = (m: ReviewMatch): string =>
  `${m.confirmed && !m.autoSelected ? 'Elegido' : CONFIDENCE_LABEL[m.confidence]}: ${m.reason}`;
