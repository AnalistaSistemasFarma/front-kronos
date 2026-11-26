import { devices, expect, test, type Page } from '@playwright/test';

/**
 * iOS focus zoom · rendered guard (2026-11-26, msg 40593: «ningún input de búsqueda en iOS debería
 * hacer zoom»). Safari on iPhone zooms when a focused field is below 16 px; app/globals.css sets a
 * global floor on touch devices. This spec loads a real page with the real CSS bundle (Mantine
 * included, which loads AFTER globals.css) on an iPhone-sized touch screen and checks:
 *  - every visible text field on the page is ≥ 16 px;
 *  - probe fields shaped like the ones that zoomed (Mantine size xs/sm, Tailwind text-xs, inline
 *    13 px, textarea, select, contenteditable) are raised to ≥ 16 px, and a Mantine xl field keeps
 *    its bigger size;
 *  - focusing them keeps visualViewport.scale at 1;
 *  - on a desktop (fine pointer) the compact sizes are untouched.
 * Static counterpart: lib/__tests__/ios-input-zoom.test.ts.
 */

const PROBES = `
  <div id="zoom-probes" style="position:fixed;left:0;top:0;width:300px;z-index:99999;background:#fff">
    <input data-probe="mantine-xs" class="mantine-Input-input mantine-TextInput-input m_8fb7ebe7" style="--input-fz: var(--mantine-font-size-xs)" placeholder="Buscar por lote, producto, OP o número…" />
    <textarea data-probe="mantine-textarea-sm" class="mantine-Input-input mantine-Textarea-input m_8fb7ebe7" style="--input-fz: var(--mantine-font-size-sm)" placeholder="Responder…"></textarea>
    <input data-probe="tailwind-text-xs" class="text-xs" type="search" />
    <input data-probe="inline-13" style="font-size:13px" type="text" />
    <select data-probe="select" style="font-size:12px"><option>A</option></select>
    <div data-probe="contenteditable" contenteditable="true" style="font-size:13px">x</div>
    <input data-probe="mantine-xl" class="mantine-Input-input m_8fb7ebe7" style="--input-fz: var(--mantine-font-size-xl)" />
  </div>`;

async function injectProbes(page: Page) {
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), PROBES);
}

async function fontPx(page: Page, probe: string): Promise<number> {
  return page.locator(`[data-probe="${probe}"]`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.describe('iOS · no zoom on focus (touch screen)', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });

  test('every text field is ≥ 16 px and focusing does not zoom', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    // Real fields of the page.
    const real = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable="true"]')]
        .filter((el) => el.offsetParent !== null && !['checkbox', 'radio', 'hidden', 'submit', 'button', 'range', 'file'].includes((el as HTMLInputElement).type))
        .map((el) => ({ name: el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName, px: parseFloat(getComputedStyle(el).fontSize) }))
    );
    for (const f of real) expect(f.px, `${f.name} font-size`).toBeGreaterThanOrEqual(16);

    await injectProbes(page);
    for (const probe of ['mantine-xs', 'mantine-textarea-sm', 'tailwind-text-xs', 'inline-13', 'select', 'contenteditable']) {
      expect(await fontPx(page, probe), probe).toBeGreaterThanOrEqual(16);
    }
    expect(await fontPx(page, 'mantine-xl'), 'bigger Mantine fields keep their size').toBeGreaterThan(16);

    for (const probe of ['mantine-xs', 'mantine-textarea-sm', 'tailwind-text-xs']) {
      await page.locator(`[data-probe="${probe}"]`).tap();
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), `${probe} scale`).toBe(1);
    }
  });

  test('pinch-zoom stays enabled (no maximum-scale / user-scalable=no)', async ({ page }) => {
    await page.goto('/login');
    const content = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
    expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
  });
});

test.describe('desktop · compact sizes untouched', () => {
  test('a 13 px field keeps 13 px with a mouse', async ({ page }) => {
    await page.goto('/login');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false);
    await injectProbes(page);
    expect(await fontPx(page, 'inline-13')).toBe(13);
  });
});
