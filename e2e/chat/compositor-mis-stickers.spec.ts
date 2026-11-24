import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { CAPTURAS, REMOTO, SECRET, abrirExpresiones, caja, capturar, guardarVideo, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Chat · compositor y «Mis stickers» (2026-10-21).
 *
 * Since 2026-11-24 the composer is a Gemini-style floating pill (Nicolás, msg
 * 39009): «+» on the left with every secondary action, the box in the middle
 * and the round send button on the right, on desktop and on the phone.
 * Below, the original Teams-style request kept for history:
 *
 * Referencia de Nicolás (2026-10-20, 13:46): el compositor de Microsoft Teams,
 * «no debe ser igual, pero al menos, con la nueva funcionalidad de los
 * stickers, debe ser similar».
 *   - escritorio: fila de íconos abajo a la derecha (formato, emoji/stickers/
 *     GIF, clip, «+», separador y enviar); la «A» despliega arriba la barra de
 *     formato; línea de acento abajo con el foco;
 *   - celular: los íconos AGRUPADOS dentro de la caja (emoji y «+»);
 *   - «Mis stickers»: cargar un WebP, enviarlo, proponerlo a la empresa y
 *     (administrador) aprobarlo.
 * Capturas en modo claro y oscuro con CAPTURAS_DIR.
 */

const WEBP = readFileSync(path.resolve(__dirname, '../../public/chat/stickers/noto/aplausos.webp'));

test.use({ video: CAPTURAS ? 'on' : 'off' });

for (const oscuro of [false, true]) {
  const modo = oscuro ? 'oscuro' : 'claro';

  test.describe(`Chat · compositor en cápsula · escritorio · ${modo}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use({ viewport: { width: 1440, height: 900 } });

    test.beforeEach(async ({ context, baseURL }) => {
      await sesion(context, baseURL!);
    });

    test('cápsula: «+» a la izquierda, caja al centro, enviar redondo a la derecha; formato arriba', async ({ page }) => {
      await simularChat(page, { gif: true, oscuro, misStickers: true });
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

      const pill = page.getByTestId('chat-composer-pill');
      await expect(pill).toBeVisible();
      await capturar(page, `escritorio-${modo}-1-compositor`);

      // Left to right on one row: «+», box, send. Nothing else on the pill.
      const mas = (await pill.getByRole('button', { name: 'Más opciones' }).boundingBox())!;
      const textarea = (await caja(page).boundingBox())!;
      const enviar = pill.getByRole('button', { name: 'Enviar mensaje' });
      const env = (await enviar.boundingBox())!;
      const cap = (await pill.boundingBox())!;
      expect(mas.x).toBeLessThan(textarea.x);
      expect(textarea.x + textarea.width).toBeLessThanOrEqual(env.x + 1);
      expect(cap.x + cap.width - (env.x + env.width)).toBeLessThan(10);
      expect(Math.abs(env.width - env.height)).toBeLessThan(1);
      await expect(pill.getByRole('button', { name: 'Formato', exact: true })).toHaveCount(0);
      await expect(pill.getByRole('button', { name: 'Adjuntar archivos' })).toHaveCount(0);
      // Single line by default and fully rounded.
      expect(cap.height).toBeLessThan(60);
      expect(parseFloat(await pill.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(24);
      // Disabled look while empty.
      await expect(enviar).toBeDisabled();

      // Grows with the text up to 6 lines, then scrolls.
      await caja(page).fill(Array.from({ length: 12 }, (_, i) => `renglón ${i + 1}`).join('\n'));
      const alta = (await caja(page).boundingBox())!.height;
      expect(alta).toBeGreaterThan(120);
      expect(alta).toBeLessThan(24 * 6 + 30);
      await expect(enviar).toBeEnabled();
      await caja(page).fill('');

      // «+» holds attach, emoji/stickers/GIF, format and the old extras.
      await pill.getByRole('button', { name: 'Más opciones' }).click();
      for (const n of ['Adjuntar archivos', 'Emojis, stickers y GIF', 'Formato', 'Código', 'Vista previa']) {
        await expect(page.getByRole('menuitem', { name: n, exact: true })).toBeVisible();
      }
      await capturar(page, `escritorio-${modo}-2-mas-opciones`);
      await page.keyboard.press('Escape');

      // «Formato» unfolds the format bar ABOVE the pill.
      await caja(page).fill('informe listo');
      await caja(page).selectText();
      await pill.getByRole('button', { name: 'Más opciones' }).click();
      await page.getByRole('menuitem', { name: 'Formato', exact: true }).click();
      const barra = page.getByRole('toolbar', { name: 'Formato del mensaje' });
      await expect(barra).toBeVisible();
      expect((await barra.boundingBox())!.y).toBeLessThan((await pill.boundingBox())!.y);
      for (const n of ['Negrita', 'Cursiva', 'Tachado', 'Lista con viñetas', 'Lista numerada', 'Cita', 'Código', 'Enlace']) {
        await expect(barra.getByRole('button', { name: n, exact: true })).toBeVisible();
      }
      await caja(page).selectText();
      await barra.getByRole('button', { name: 'Negrita', exact: true }).click();
      await expect(caja(page)).toHaveValue('**informe listo**');
      await capturar(page, `escritorio-${modo}-3-barra-formato`);

      // Emoji | Stickers | GIF from the «+» menu, «Mis stickers» first.
      await abrirExpresiones(page);
      const panel = page.getByTestId('chat-expresiones');
      await expect(panel.getByRole('button', { name: 'Paquete Mis stickers' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Agregar un sticker propio' })).toBeVisible();
      await capturar(page, `escritorio-${modo}-4-panel-mis-stickers`);
    });
  });
}

test.describe('Chat · «Mis stickers» · escritorio', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('cargar un WebP propio, enviarlo, proponerlo a la empresa y aprobarlo (administrador)', async ({ page }, info) => {
    const estado = await simularChat(page, { misStickers: true, admin: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

    await abrirExpresiones(page);
    await page.getByTestId('chat-expresiones').getByRole('button', { name: 'Agregar un sticker propio' }).click();
    const ventana = page.getByTestId('chat-mis-stickers');
    await expect(ventana).toBeVisible();
    await expect(ventana.getByText('Aún no tiene stickers propios.')).toBeVisible();

    // Un archivo que no es WebP se rechaza antes de subir.
    const [selectorMalo] = await Promise.all([page.waitForEvent('filechooser'), ventana.getByRole('button', { name: 'Escoger archivo WebP' }).click()]);
    await selectorMalo.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('png') });
    await expect(ventana.getByText('El sticker debe ser una imagen WebP (estática o animada).')).toBeVisible();

    const [selector] = await Promise.all([page.waitForEvent('filechooser'), ventana.getByRole('button', { name: 'Escoger archivo WebP' }).click()]);
    await selector.setFiles({ name: 'bravo-equipo.webp', mimeType: 'image/webp', buffer: WEBP });
    await expect(ventana.getByRole('img', { name: 'Vista previa del sticker' })).toBeVisible();
    await ventana.getByLabel('Nombre').fill('¡Bravo, equipo!');
    await capturar(page, 'escritorio-6-mis-stickers-cargar');
    await ventana.getByRole('button', { name: 'Guardar' }).click();
    await expect(ventana.getByText('Sticker agregado a «Mis stickers».')).toBeVisible();
    expect(estado.subidos).toBe(1);
    await expect(ventana.getByText('¡Bravo, equipo!')).toBeVisible();

    // Proponerlo a la empresa → aparece en «Propuestas por revisar» → aprobar.
    await ventana.getByRole('button', { name: 'Proponer' }).click();
    await expect(ventana.getByText('Sticker propuesto a la empresa. Un administrador lo revisará.')).toBeVisible();
    expect(estado.propuestas.at(-1)).toEqual({ id: 501, idCompany: 3 });
    await expect(ventana.getByText('Propuesto a la empresa · ONE LATAM PHARMA')).toBeVisible();
    await expect(ventana.getByText('Laura · para ONE LATAM PHARMA')).toBeVisible();
    await capturar(page, 'escritorio-7-mis-stickers-propuesta');
    await ventana.getByRole('button', { name: 'Aprobar' }).click();
    await expect(ventana.getByText('«¡Bravo, equipo!» quedó como sticker de ONE LATAM PHARMA.')).toBeVisible();
    expect(estado.revisiones.at(-1)).toEqual({ id: 501, accion: 'aprobar' });
    await page.keyboard.press('Escape');

    // Enviarlo desde «Mis stickers».
    await abrirExpresiones(page);
    await page.getByTestId('chat-expresiones').getByRole('button', { name: 'Enviar sticker ¡Bravo, equipo!' }).click();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', idSticker: 501 });
    await page.waitForTimeout(800);
    await capturar(page, 'escritorio-8-mi-sticker-enviado');
    await guardarVideo(page, info, 'escritorio-video-mis-stickers');
  });
});

for (const oscuro of [false, true]) {
  const modo = oscuro ? 'oscuro' : 'claro';
  test.describe(`Chat · compositor en cápsula · celular · ${modo}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ context, baseURL }) => {
      await sesion(context, baseURL!);
    });

    test('la misma cápsula: «+» con adjuntar, emoji y formato; enviar redondo a la derecha', async ({ page }) => {
      await simularChat(page, { gif: true, oscuro, misStickers: true });
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

      const pill = page.getByTestId('chat-composer-pill');
      await expect(pill).toBeVisible();
      const cap = (await pill.boundingBox())!;
      // No horizontal overflow at 390 px.
      expect(cap.x).toBeGreaterThanOrEqual(0);
      expect(cap.x + cap.width).toBeLessThanOrEqual(390);
      await capturar(page, `celular-${modo}-1-compositor`);

      await pill.getByRole('button', { name: 'Más opciones' }).tap();
      await expect(page.getByRole('menuitem', { name: 'Adjuntar archivos' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Emojis, stickers y GIF' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Formato' })).toBeVisible();
      await capturar(page, `celular-${modo}-2-mas-opciones`);
      await page.getByRole('menuitem', { name: 'Formato' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Formato del mensaje' })).toBeVisible();
      await caja(page).fill('hola');
      await caja(page).selectText();
      await page.getByRole('toolbar', { name: 'Formato del mensaje' }).getByRole('button', { name: 'Cursiva' }).tap();
      await expect(caja(page)).toHaveValue('_hola_');
      await capturar(page, `celular-${modo}-3-formato`);

      await abrirExpresiones(page, { tocar: true });
      await expect(page.locator('.chat-expresiones-hoja')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Paquete Mis stickers' })).toBeVisible();
      // The «+» turns into «Volver al teclado» while the sheet is open.
      await expect(pill.getByRole('button', { name: 'Volver al teclado' })).toBeVisible();
      await capturar(page, `celular-${modo}-4-hoja-mis-stickers`);
    });
  });
}
