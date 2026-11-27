import { expect, test, type Page } from '@playwright/test';
import { CAPTURAS, REMOTO, SECRET, capturar, caja, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Chat · voice notes (2026-11-26, Nicolás Rivera, SynerLink conv 1 msg 41101).
 *
 * With the box empty the send slot is a mic. Tap → records (fake microphone of
 * Chromium) with timer and live waveform → send. The bubble draws a player
 * (play/pause, progress, speed, download) and the transcript collapsed below.
 * Discard sends nothing; a denied microphone shows a clear Spanish message.
 * APIs simulated; the real server path is covered by lib/chat/__tests__/voice-note.test.ts.
 */

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

/** 1 s of a 440 Hz tone as WAV (the "stored" audio served back to the player). */
function tonoWav(): Buffer {
  const rate = 8000;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

async function simulateVoiceNote(page: Page) {
  const sentNotes: { voiceNote: boolean; durationMs: number; bytes: number }[] = [];
  await page.route(/\/api\/chat\/conversations\/\d+\/messages(\?|$)/, async (r, request) => {
    if (request.method() !== 'POST') return r.fallback();
    const raw = request.postDataBuffer() ?? Buffer.alloc(0);
    const text = raw.toString('latin1');
    const durationMs = Number(/name="voiceDurationMs"\r\n\r\n(\d+)/.exec(text)?.[1] ?? 0);
    sentNotes.push({ voiceNote: /name="voiceNote"\r\n\r\n1/.test(text), durationMs, bytes: raw.length });
    const segundos = Math.round(durationMs / 1000);
    return r.fulfill({
      status: 201,
      json: {
        message: {
          id: 900,
          role: 'user',
          body: `[Nota de voz · 0:${String(segundos).padStart(2, '0')}]\nTranscripción automática: Hola, le comento que la solicitud de compra ya quedó aprobada.`,
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          attachments: [
            { id: 77, fileName: 'nota-de-voz-20261126-180000.wav', contentType: 'audio/wav', sizeBytes: 16044, downloadUrl: '/api/chat/attachments/77' },
          ],
        },
        notifiedAgents: [],
      },
    });
  });
  await page.route('**/api/chat/attachments/77', (r) =>
    r.fulfill({ status: 200, body: tonoWav(), headers: { 'Content-Type': 'audio/wav', 'Content-Disposition': 'attachment; filename="nota-de-voz.wav"' } })
  );
  return sentNotes;
}

for (const [nombre, viewport] of [
  ['escritorio', { width: 1440, height: 900 }],
  ['celular', { width: 390, height: 844 }],
] as const) {
  test.describe(`Chat · notas de voz · ${nombre}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use({ viewport });

    test.beforeEach(async ({ context, baseURL }) => {
      await sesion(context, baseURL!);
    });

    test('grabar, enviar, reproducir y ver la transcripción', async ({ page }) => {
      await simularChat(page);
      const sentNotes = await simulateVoiceNote(page);
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

      const pill = page.getByTestId('chat-composer-pill');
      const microfono = pill.getByRole('button', { name: 'Grabar una nota de voz' });
      await expect(microfono).toBeVisible();
      await capturar(page, `notas-voz-${nombre}-1-microfono`);

      // Typing turns the mic back into send.
      await caja(page).fill('hola');
      await expect(pill.getByRole('button', { name: 'Enviar mensaje' })).toBeVisible();
      await expect(microfono).toHaveCount(0);
      await caja(page).fill('');

      await microfono.click();
      const grabando = page.getByTestId('chat-nota-voz-grabando');
      await expect(grabando).toBeVisible();
      await expect(grabando.getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(1200);
      await capturar(page, `notas-voz-${nombre}-2-grabando`);
      await grabando.getByRole('button', { name: 'Enviar la nota de voz' }).click();

      await expect.poll(() => sentNotes.length).toBe(1);
      expect(sentNotes[0].voiceNote).toBe(true);
      expect(sentNotes[0].durationMs).toBeGreaterThan(1500);
      expect(sentNotes[0].bytes).toBeGreaterThan(500);

      const voiceNote = hilo(page).getByTestId('chat-nota-voz').last();
      await expect(voiceNote).toBeVisible();
      // The descriptive body is not drawn as text.
      await expect(hilo(page).getByText('[Nota de voz', { exact: false })).toHaveCount(0);

      await voiceNote.getByRole('button', { name: 'Reproducir la nota de voz' }).click();
      await expect(voiceNote.getByRole('button', { name: 'Pausar la nota de voz' })).toBeVisible();
      await voiceNote.getByTestId('chat-nota-voz-velocidad').click();
      await expect(voiceNote.getByTestId('chat-nota-voz-velocidad')).toHaveText('1.5x');
      await voiceNote.getByTestId('chat-nota-voz-velocidad').click();
      await expect(voiceNote.getByTestId('chat-nota-voz-velocidad')).toHaveText('2x');
      await expect(voiceNote.getByRole('link', { name: 'Descargar el audio' })).toHaveAttribute('href', '/api/chat/attachments/77');

      await voiceNote.getByTestId('chat-nota-voz-transcripcion').click();
      await expect(voiceNote.getByText('la solicitud de compra ya quedó aprobada')).toBeVisible();
      await capturar(page, `notas-voz-${nombre}-3-enviada`);
    });

    test('descartar no envía nada', async ({ page }) => {
      await simularChat(page);
      const sentNotes = await simulateVoiceNote(page);
      await page.goto('/process/chat?agent=horus');
      await page.getByRole('button', { name: 'Grabar una nota de voz' }).click();
      await expect(page.getByTestId('chat-nota-voz-grabando')).toBeVisible();
      await page.getByRole('button', { name: 'Descartar la nota de voz' }).click();
      await expect(page.getByTestId('chat-nota-voz-grabando')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-pill')).toBeVisible();
      await page.waitForTimeout(500);
      expect(sentNotes).toHaveLength(0);
    });

    test('micrófono bloqueado: mensaje claro en español', async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
      });
      await simularChat(page);
      await page.goto('/process/chat?agent=horus');
      await page.getByRole('button', { name: 'Grabar una nota de voz' }).click();
      await expect(page.getByTestId('chat-nota-voz-error')).toContainText('no tiene permiso para usar el micrófono');
      await expect(page.getByTestId('chat-nota-voz-grabando')).toHaveCount(0);
      if (CAPTURAS) await capturar(page, `notas-voz-${nombre}-4-permiso`);
    });
  });
}
