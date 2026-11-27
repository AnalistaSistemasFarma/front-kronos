import { expect, test } from '@playwright/test';
import { REMOTO, SECRET, abrirExpresiones, capturar, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Chat · the turn just sent is pinned at the top (Nicolás, msg 39065, like
 * Gemini): after sending, the new message sits right under the header with
 * empty space below for the reply.
 */
test.describe('Chat · turno arriba · celular', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('al enviar, el mensaje queda arriba con espacio debajo', async ({ page }) => {
    await simularChat(page, { largo: true, gif: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('número 24')).toBeVisible();
    const espaciador = page.locator('.chat-thread__espaciador-turno');
    await expect(espaciador).toHaveJSProperty('offsetHeight', 0);

    await abrirExpresiones(page, { tocar: true });
    await page.locator('.chat-expresiones-hoja').getByRole('button', { name: /^Enviar sticker/ }).first().tap();
    await page.getByRole('button', { name: 'Volver al teclado' }).tap();

    const distancia = async () =>
      page.evaluate(() => {
        const vp = document.querySelector('.chat-thread__scroll .mantine-ScrollArea-viewport') as HTMLElement;
        const propios = document.querySelectorAll('.chat-bubble--user');
        const fila = propios[propios.length - 1].closest('.chat-msg') as HTMLElement;
        return Math.round(fila.getBoundingClientRect().top - vp.getBoundingClientRect().top);
      });
    await expect.poll(distancia).toBeGreaterThanOrEqual(4);
    await expect.poll(distancia).toBeLessThanOrEqual(12);
    expect(await espaciador.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThan(100);
    await capturar(page, 'celular-turno-arriba');
  });
});
