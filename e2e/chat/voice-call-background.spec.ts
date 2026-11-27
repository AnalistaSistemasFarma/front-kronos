import { expect, test, type Page } from '@playwright/test';
import { REMOTO, SECRET, hilo, sesion, simularChat } from './chat-simulado';

/**
 * Voice call in the background (2026-11-25, Nicolás msg 39354): «si cambio de
 * pestaña se cuelga la llamada; eso debe quedar en segundo plano para yo ir
 * trabajando».
 *
 * Simulated chat with Duo plus a fake WebRTC/microphone (no audio, no
 * OpenClaw): checks that the call survives navigating to another SynerLink
 * section and hiding the tab, that the floating bar controls it, and that it
 * only ends on hang up.
 */

const DUO = {
  idAgent: 7,
  code: 'duo',
  displayName: 'Duo',
  sortOrder: 1,
  handle: '@duo_gss_bot',
  avatarUrl: null,
  avatarVersion: null,
  description: null,
  companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
  busy: false,
};
const CONVERSATION = {
  id: 101,
  kind: 'direct',
  title: null,
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  updatedAt: new Date().toISOString(),
  lastMessageAt: new Date().toISOString(),
  archived: false,
  agent: { idAgent: 7, code: 'duo', displayName: 'Duo', handle: '@duo_gss_bot', avatarUrl: null },
  lastMessage: { id: 1003, role: 'agent', preview: 'Listo', createdAt: new Date().toISOString() },
  unreadCount: 0,
  agentStatus: { state: 'idle', label: null, updatedAt: new Date().toISOString() },
  agentStatuses: [],
};

/** Fake microphone and RTCPeerConnection: «connected» once the answer arrives. */
async function webrtcSimulado(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pcs: { closed: boolean }[] };
    w.__pcs = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    });
    class FakePeerConnection {
      connectionState = 'new';
      closed = false;
      onconnectionstatechange: null | (() => void) = null;
      ontrack = null;
      constructor() { w.__pcs.push(this); }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0 fake-offer' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        setTimeout(() => { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }, 50);
      }
      close() { this.closed = true; this.connectionState = 'closed'; }
    }
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection;
  });
}

async function simulateVoice(page: Page) {
  const actions: string[] = [];
  await page.route(/\/api\/chat\/conversations\/\d+\/voice$/, (r) => {
    const body = r.request().postDataJSON() as { action: string };
    actions.push(body.action);
    if (body.action === 'offer') return r.fulfill({ json: { callId: 'llamada-e2e' } });
    if (body.action === 'close') return r.fulfill({ json: { ok: true } });
    return r.fulfill({ json: { sdp: 'v=0 fake-answer', error: null } });
  });
  return actions;
}

test.describe('Chat · llamada de voz en segundo plano', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('la llamada sigue al cambiar de sección y al ocultar la pestaña; solo Colgar la termina', async ({ page }) => {
    await simularChat(page);
    // Registered after simularChat: Playwright gives precedence to the latest route.
    await page.route('**/api/chat/access', (r) =>
      r.fulfill({ json: { canUseChat: true, canBroadcast: false, canCreateGroups: false, canMessagePeople: false, companies: DUO.companies, agents: [DUO] } })
    );
    await page.route('**/api/chat/conversations', (r) =>
      r.fulfill({ json: r.request().method() === 'GET' ? { conversations: [CONVERSATION] } : { conversation: CONVERSATION } })
    );
    await page.route(/\/api\/chat\/conversations\/\d+$/, (r) => r.fulfill({ json: { conversation: CONVERSATION } }));
    await webrtcSimulado(page);
    const actions = await simulateVoice(page);

    await page.goto('/process/chat?agent=duo');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();
    await page.getByRole('button', { name: 'Hablar en tiempo real' }).click();

    const barra = page.getByTestId('voice-call-bar');
    // On the call's own conversation the composer mic holds the controls.
    await expect(page.getByRole('status').getByText('Voz conectada')).toBeVisible();
    await expect(barra).toHaveCount(0);
    expect(actions.slice(0, 2)).toEqual(['offer', 'poll']);
    await page.keyboard.press('Escape');

    // Another SynerLink section (client navigation): the chat unmounts, the call stays.
    await page.getByRole('banner').getByRole('button', { name: 'Procesos', exact: true }).click();
    await expect(page).toHaveURL(/\/process(\?|$)/);
    await expect(hilo(page)).toHaveCount(0);
    await expect(barra.getByText('Llamada con Duo')).toBeVisible();
    await expect(barra.getByRole('button', { name: 'Volver al chat' })).toBeVisible();
    expect(actions).not.toContain('close');
    expect(await page.evaluate(() => (window as unknown as { __pcs: { closed: boolean }[] }).__pcs.every((pc) => !pc.closed))).toBe(true);

    // Hidden tab and back: never hangs up; coming back refreshes the call at once.
    const polls = () => actions.filter((a) => a === 'poll').length;
    const antes = polls();
    await page.evaluate(() => {
      const fijar = (v: string) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      fijar('hidden');
      window.dispatchEvent(new Event('blur'));
      fijar('visible');
    });
    await expect.poll(polls).toBeGreaterThan(antes);
    await expect(barra.getByText('Llamada con Duo')).toBeVisible();
    expect(actions).not.toContain('close');

    // Mute from the bar.
    await barra.getByRole('button', { name: 'Silenciar' }).click();
    await expect(barra.getByRole('button', { name: 'Activar micrófono' })).toHaveAttribute('aria-pressed', 'true');

    // Back to the chat, still in the call.
    await barra.getByRole('button', { name: 'Volver al chat' }).click();
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();
    await expect(barra).toHaveCount(0);
    const mic = page.getByRole('button', { name: 'Controles de llamada' });
    await expect(mic).toBeVisible();
    expect(actions).not.toContain('close');

    // Closing the page asks first while in a call.
    const dialogo = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const d = await dialogo;
    expect(d.type()).toBe('beforeunload');
    await d.dismiss();
    await expect(mic).toBeVisible();

    // Only hanging up ends it.
    await mic.click();
    await page.getByRole('button', { name: 'Colgar' }).click();
    await expect(page.getByRole('button', { name: 'Hablar en tiempo real' })).toBeVisible();
    expect(actions).toContain('close');
  });
});
