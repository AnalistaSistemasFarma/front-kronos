/* eslint-disable security/detect-non-literal-fs-filename -- static guard reads files of this repo */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: NO text field may zoom the page on iOS (2026-11-26, msg 40593, repeated request).
 *
 * Safari on iPhone zooms when a focused input/textarea/select has a computed font-size below
 * 16 px. app/globals.css has a GLOBAL floor for touch devices; this static check fails the CI if
 * that floor disappears, if some stylesheet forces a smaller size with !important (which would beat
 * the floor), or if pinch-zoom gets disabled instead. The rendered check lives in
 * e2e/ios-input-zoom.spec.ts.
 */

const ROOT = join(__dirname, '..', '..');
const GLOBALS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Flat `selector { body }` blocks (enough for our stylesheets; @media wrappers are skipped). */
function rules(css: string): { selector: string; body: string }[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

const FIELD_SELECTOR = /(^|[\s,>+~(])(input|textarea|select)\b|-input\b|Input-input|Textarea-input|contenteditable/i;

function toPx(value: string): number | null {
  const m = value.trim().match(/^([\d.]+)(px|rem|em)$/);
  if (!m) return null;
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
}

describe('iOS focus zoom guard', () => {
  it('globals.css keeps the global ≥ 16 px floor for every text field on touch devices', () => {
    const floor = rules(GLOBALS).filter((r) => /font-size:\s*max\(16px,[^;]*\)\s*!important/.test(r.body));
    const selectors = floor.map((r) => r.selector).join(' ');
    expect(floor.length).toBeGreaterThanOrEqual(2);
    for (const tag of ['input:where(', 'textarea', 'select', '[contenteditable]']) {
      expect(selectors).toContain(tag);
    }
    expect(GLOBALS).toMatch(/@media \(pointer: coarse\) \{\s*input:where\(/);
    expect(GLOBALS).toMatch(/@supports \(-webkit-touch-callout: none\) \{\s*input:where\(/);
  });

  it('no stylesheet forces a text field below 16 px with !important', () => {
    const offenders: string[] = [];
    for (const file of [...cssFiles(join(ROOT, 'app')), ...cssFiles(join(ROOT, 'components'))]) {
      for (const r of rules(readFileSync(file, 'utf8'))) {
        if (!FIELD_SELECTOR.test(r.selector)) continue;
        const m = r.body.match(/font-size:\s*([^;!]+)!important/);
        if (!m) continue;
        const px = toPx(m[1]);
        if (px !== null && px < 16) offenders.push(`${file.replace(ROOT, '')}: ${r.selector} → ${m[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not disable pinch-zoom (accessibility) to hide the problem', () => {
    const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/maximumScale\s*:\s*1\b/);
    expect(layout).not.toMatch(/userScalable\s*:\s*false/);
    expect(layout).not.toMatch(/maximum-scale\s*=\s*1/);
  });
});
