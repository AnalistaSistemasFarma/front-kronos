import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { CAPTURAS, REMOTO, SECRET, caja, capturar, guardarVideo, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Chat · compositor estilo Teams y «Mis stickers» (2026-10-21).
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

  test.describe(`Chat · compositor estilo Teams · escritorio · ${modo}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use({ viewport: { width: 1440, height: 900 } });

    test.beforeEach(async ({ context, baseURL }) => {
      await sesion(context, baseURL!);
    });

    test('fila de íconos abajo a la derecha, barra de formato arriba y línea de acento con el foco', async ({ page }) => {
      await simularChat(page, { gif: true, oscuro, misStickers: true });
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

      const compositor = page.locator('.chat-composer--marco');
      await expect(compositor).toBeVisible();
      await capturar(page, `escritorio-${modo}-1-compositor`);

      // Orden de la fila, de izquierda a derecha, y enviar al final, separado.
      const nombres = ['Formato', 'Emojis, stickers y GIF', 'Adjuntar archivos', 'Más opciones', 'Enviar mensaje'];
      const cajas = [];
      for (const n of nombres) cajas.push((await compositor.getByRole('button', { name: n, exact: true }).boundingBox())!);
      for (let i = 1; i < cajas.length; i++) {
        expect(cajas[i].x).toBeGreaterThan(cajas[i - 1].x);
        expect(Math.abs(cajas[i].y - cajas[0].y)).toBeLessThan(4);
      }
      const marco = (await compositor.boundingBox())!;
      const textarea = (await caja(page).boundingBox())!;
      // Íconos DEBAJO de la caja y pegados a la derecha del marco.
      expect(cajas[0].y).toBeGreaterThan(textarea.y + textarea.height - 4);
      expect(marco.x + marco.width - (cajas[4].x + cajas[4].width)).toBeLessThan(16);
      expect(cajas[4].x - (cajas[3].x + cajas[3].width)).toBeGreaterThan(8);

      // Línea de acento abajo SOLO con el foco.
      const acento = () => compositor.evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
      const sinFoco = await acento();
      await caja(page).click();
      await expect.poll(acento).not.toBe(sinFoco);
      await capturar(page, `escritorio-${modo}-2-foco-acento`);

      // La «A» despliega la barra de formato ARRIBA de la caja.
      await caja(page).fill('informe listo');
      await caja(page).selectText();
      await compositor.getByRole('button', { name: 'Formato', exact: true }).click();
      const barra = compositor.getByRole('toolbar', { name: 'Formato del mensaje' });
      await expect(barra).toBeVisible();
      expect((await barra.boundingBox())!.y).toBeLessThan((await caja(page).boundingBox())!.y);
      for (const n of ['Negrita', 'Cursiva', 'Tachado', 'Lista con viñetas', 'Lista numerada', 'Cita', 'Código', 'Enlace']) {
        await expect(barra.getByRole('button', { name: n, exact: true })).toBeVisible();
      }
      await barra.getByRole('button', { name: 'Negrita', exact: true }).click();
      await expect(caja(page)).toHaveValue('**informe listo**');
      await barra.getByRole('button', { name: 'Tachado', exact: true }).click();
      await expect(caja(page)).toHaveValue('**~~informe listo~~**');
      await capturar(page, `escritorio-${modo}-3-barra-formato`);

      // «+»: más acciones.
      await compositor.getByRole('button', { name: 'Más opciones' }).click();
      await expect(page.getByRole('menuitem', { name: 'Vista previa' })).toBeVisible();
      await capturar(page, `escritorio-${modo}-4-mas-opciones`);
      await page.keyboard.press('Escape');

      // Panel de stickers desde su botón, con «Mis stickers» primero.
      await compositor.getByRole('button', { name: 'Emojis, stickers y GIF' }).click();
      const panel = page.getByTestId('chat-expresiones');
      await expect(panel.getByRole('button', { name: 'Paquete Mis stickers' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Agregar un sticker propio' })).toBeVisible();
      await capturar(page, `escritorio-${modo}-5-panel-mis-stickers`);
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

    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).click();
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
    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).click();
    await page.getByTestId('chat-expresiones').getByRole('button', { name: 'Enviar sticker ¡Bravo, equipo!' }).click();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', idSticker: 501 });
    await page.waitForTimeout(800);
    await capturar(page, 'escritorio-8-mi-sticker-enviado');
    await guardarVideo(page, info, 'escritorio-video-mis-stickers');
  });
});

for (const oscuro of [false, true]) {
  const modo = oscuro ? 'oscuro' : 'claro';
  test.describe(`Chat · compositor estilo Teams · celular · ${modo}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ context, baseURL }) => {
      await sesion(context, baseURL!);
    });

    test('íconos agrupados dentro de la caja: emoji y «+» con adjuntar y formato', async ({ page }) => {
      await simularChat(page, { gif: true, oscuro, misStickers: true });
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

      // Sin marco ni fila de escritorio: la cápsula de una fila.
      await expect(page.locator('.chat-composer--marco')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Formato', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Adjuntar archivos' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Emojis, stickers y GIF' })).toBeVisible();
      await capturar(page, `celular-${modo}-1-compositor`);

      await page.getByRole('button', { name: 'Más opciones' }).tap();
      await expect(page.getByRole('menuitem', { name: 'Adjuntar archivos' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Formato' })).toBeVisible();
      await capturar(page, `celular-${modo}-2-mas-opciones`);
      await page.getByRole('menuitem', { name: 'Formato' }).tap();
      await expect(page.getByRole('toolbar', { name: 'Formato del mensaje' })).toBeVisible();
      await caja(page).fill('hola');
      await caja(page).selectText();
      await page.getByRole('toolbar', { name: 'Formato del mensaje' }).getByRole('button', { name: 'Cursiva' }).tap();
      await expect(caja(page)).toHaveValue('_hola_');
      await capturar(page, `celular-${modo}-3-formato`);

      await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).tap();
      await expect(page.locator('.chat-expresiones-hoja')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Paquete Mis stickers' })).toBeVisible();
      await capturar(page, `celular-${modo}-4-hoja-mis-stickers`);
    });
  });
}
