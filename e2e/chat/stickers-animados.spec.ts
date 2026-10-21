import { expect, test } from '@playwright/test';
import { CAPTURAS, REMOTO, SECRET, capturar, caja, guardarVideo, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Chat · stickers ANIMADOS y panel Emoji | Stickers | GIF (2026-10-20).
 *
 * Pedido de Nicolás (2026-10-20, 12:16): stickers animados como Telegram o
 * WhatsApp y un botón propio AL LADO del clip (no dentro del menú del clip).
 *
 * Con sesión firmada (NEXTAUTH_SECRET de la CI) y TODO el chat simulado con
 * `page.route`, igual que reacciones-stickers.spec.ts. Las imágenes de los
 * stickers son las REALES de public/chat/stickers (no se simulan).
 *   - escritorio: botón al lado del clip → globo con pestañas; barra de
 *     paquetes; emoji en el texto; sticker animado enviado y en movimiento;
 *     sin llave de GIF no hay pestaña GIF; con prefers-reduced-motion queda
 *     quieto; fuera de pantalla se pausa (no se monta el animado).
 *   - celular: el panel es una hoja que reemplaza al teclado; el botón pasa a
 *     «Volver al teclado».
 *
 * Capturas y video para el PR: con CAPTURAS_DIR definido se guardan ahí.
 */

// Video solo cuando se piden capturas (evidencia del PR); en la CI, apagado.
test.use({ video: CAPTURAS ? 'on' : 'off' });

test.describe('Chat · stickers animados · escritorio', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('botón al lado del clip: Emoji | Stickers | GIF, paquetes, emoji en el texto y sticker animado en el hilo', async ({ page }, info) => {
    const estado = await simularChat(page, { gif: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

    // El sticker del historial se mueve (el animado ya cargó encima del cuadro fijo).
    const delHistorial = hilo(page).locator('.chat-sticker-anim').first();
    await expect(delHistorial).toHaveAttribute('data-animando', 'true');
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡Listo!' })).toBeVisible();
    // El contrato con los agentes no cambia: el texto descriptivo no se pinta.
    await expect(hilo(page).getByText('[Sticker: ¡Listo!]')).toHaveCount(0);

    // Ni el clip ni el «+» traen la opción de stickers (desde el 2026-10-21 el
    // clip adjunta directo, como en Teams).
    await page.getByRole('button', { name: 'Más opciones' }).click();
    await expect(page.getByRole('menuitem', { name: /Stickers/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Botón propio, al lado del clip (misma fila, a su izquierda).
    const boton = page.getByRole('button', { name: 'Emojis, stickers y GIF' });
    const clip = page.getByRole('button', { name: 'Adjuntar archivos' });
    const [b, c] = [(await boton.boundingBox())!, (await clip.boundingBox())!];
    expect(Math.abs(b.y - c.y)).toBeLessThan(4);
    expect(b.x).toBeLessThan(c.x);
    expect(c.x - (b.x + b.width)).toBeLessThan(12);

    await boton.click();
    const panel = page.getByTestId('chat-expresiones');
    await expect(panel.getByRole('tab', { name: 'Emoji' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('tab', { name: 'GIF' })).toBeVisible();
    await expect(panel.getByRole('toolbar', { name: 'Paquetes de stickers' }).getByRole('button')).toHaveCount(2);
    await expect(panel.getByText(/Noto Emoji Animation de Google · CC BY 4\.0/)).toBeVisible();
    // Las miniaturas animadas visibles se mueven.
    await expect(panel.locator('.chat-sticker-anim[data-animando="true"]').first()).toBeVisible();
    await capturar(page, 'escritorio-1-panel-stickers');

    // Paquete estático del #698: sigue ahí.
    await panel.getByRole('button', { name: 'Paquete GSS' }).click();
    await expect(panel.getByRole('button', { name: 'Enviar sticker un-tinto' })).toBeInViewport();
    await capturar(page, 'escritorio-2-paquete-gss');

    // Emoji: se inserta en el texto, el panel sigue abierto.
    await panel.getByRole('tab', { name: 'Emoji' }).click();
    await panel.getByLabel('Buscar emoji').fill('fiesta');
    await panel.getByRole('button', { name: 'fiesta celebración' }).click();
    await expect(caja(page)).toHaveValue('🎉');
    await capturar(page, 'escritorio-3-pestana-emoji');

    // Sticker animado: se envía con su código y llega en movimiento.
    await panel.getByRole('tab', { name: 'Stickers' }).click();
    await panel.getByRole('button', { name: 'Enviar sticker ¡Aplausos!' }).click();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', code: 'noto-aplausos' });
    const enviado = hilo(page).getByRole('img', { name: 'Sticker: ¡Aplausos!' });
    await expect(enviado).toBeVisible();
    await expect(hilo(page).locator('.chat-sticker-anim').last()).toHaveAttribute('data-animando', 'true');
    // En escritorio el globo se cierra al enviar; el texto escrito se conserva.
    await expect(panel).toBeHidden();
    await expect(caja(page)).toHaveValue('🎉');
    await page.waitForTimeout(1500);
    await capturar(page, 'escritorio-4-sticker-animado-enviado');
    await guardarVideo(page, info, 'escritorio-video-panel-y-sticker');
  });

  test('sin llave de GIF no aparece la pestaña GIF', async ({ page }) => {
    await simularChat(page, { gif: false });
    await page.goto('/process/chat?agent=horus');
    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).click();
    const panel = page.getByTestId('chat-expresiones');
    await expect(panel.getByRole('tab', { name: 'Stickers' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'GIF' })).toHaveCount(0);
  });

  test('fuera de pantalla el sticker se pausa y vuelve a moverse al verse', async ({ page }) => {
    await simularChat(page, { largo: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('número 24')).toBeVisible();
    const sticker = hilo(page).locator('.chat-sticker-anim').first();
    // Arriba, fuera de la vista: solo el cuadro fijo, sin el animado montado.
    await expect(sticker).toHaveAttribute('data-animando', 'false');
    await expect(sticker.locator('.chat-sticker-anim__mov')).toHaveCount(0);
    await sticker.scrollIntoViewIfNeeded();
    await expect(sticker).toHaveAttribute('data-animando', 'true');
  });
});

test.describe('Chat · stickers animados · menos movimiento', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('con prefers-reduced-motion el sticker queda quieto (cuadro fijo)', async ({ context, baseURL, page }) => {
    await sesion(context, baseURL!);
    await simularChat(page);
    await page.goto('/process/chat?agent=horus');
    const sticker = hilo(page).locator('.chat-sticker-anim').first();
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡Listo!' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(sticker).toHaveAttribute('data-animando', 'false');
    await expect(sticker.locator('.chat-sticker-anim__mov')).toHaveCount(0);
  });
});

test.describe('Chat · stickers animados · celular', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('el panel es una hoja que reemplaza al teclado y se vuelve al teclado con el mismo botón', async ({ page }, info) => {
    const estado = await simularChat(page, { gif: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();
    await capturar(page, 'celular-1-hilo-con-sticker');

    await caja(page).tap();
    await expect(caja(page)).toBeFocused();
    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).tap();

    const hoja = page.locator('.chat-expresiones-hoja');
    await expect(hoja).toBeVisible();
    // El teclado se va (la caja suelta el foco) y la hoja queda pegada abajo.
    await expect(caja(page)).not.toBeFocused();
    const h = (await hoja.boundingBox())!;
    expect(Math.round(h.y + h.height)).toBeGreaterThanOrEqual(830);
    await expect(page.getByRole('button', { name: 'Volver al teclado' })).toBeVisible();
    await capturar(page, 'celular-2-hoja-stickers');

    // Enviar un sticker: la hoja queda abierta, como en WhatsApp.
    await hoja.getByRole('button', { name: 'Enviar sticker ¡A celebrar!' }).tap();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', code: 'noto-celebracion' });
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡A celebrar!' })).toBeVisible();
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(1200);
    await capturar(page, 'celular-3-sticker-enviado');

    await hoja.getByRole('tab', { name: 'Emoji' }).tap();
    await hoja.getByRole('button', { name: 'pulgar arriba me gusta de acuerdo' }).first().tap();
    await expect(caja(page)).toHaveValue('👍');
    // El emoji no abre el teclado encima del panel.
    await expect(caja(page)).not.toBeFocused();
    await capturar(page, 'celular-4-hoja-emoji');

    // Volver al teclado: la hoja se va y la caja recibe el foco.
    await page.getByRole('button', { name: 'Volver al teclado' }).tap();
    await expect(hoja).toBeHidden();
    await expect(caja(page)).toBeFocused();
    await guardarVideo(page, info, 'celular-video-hoja-y-sticker');
  });
});
