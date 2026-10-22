import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Chat · el hilo no parpadea (2026-10-17, «lo del parpadeo del chat no se ha
 * solucionado, a veces vuelve»).
 *
 * Con sesión firmada (NEXTAUTH_SECRET de la CI) y TODO el chat simulado con
 * `page.route`: catálogo, bandeja, histórico, sondeo, leído, anclas y pulso.
 * Un MutationObserver y un muestreo por cuadro (requestAnimationFrame) miden lo
 * que el ojo ve como parpadeo:
 *   - burbujas que se desmontan y se vuelven a montar;
 *   - burbujas del historial que entran con la animación de «mensaje nuevo»
 *     (`chat-bubble--nueva`, desde opacidad 0);
 *   - un cuadro con el encabezado del hilo NUEVO y los mensajes del ANTERIOR;
 *   - el esqueleto que reaparece.
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const USUARIO = { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' };

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const AGENTES = [
  { idAgent: 1, code: 'horus', displayName: 'Orus', sortOrder: 1 },
  { idAgent: 2, code: 'mark', displayName: 'Mark', sortOrder: 2 },
].map((a) => ({
  ...a,
  handle: `@${a.code}_gss_bot`,
  avatarUrl: null,
  avatarVersion: null,
  description: null,
  companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
  busy: false,
}));

/** Hilo directo con un agente: id de conversación = 100 + idAgent. */
function directa(idAgent: number) {
  const a = AGENTES.find((x) => x.idAgent === idAgent)!;
  return {
    id: 100 + idAgent,
    kind: 'direct',
    title: null,
    createdAt: hace(10_000),
    updatedAt: hace(5),
    lastMessageAt: hace(5),
    archived: false,
    agent: { idAgent, code: a.code, displayName: a.displayName, handle: a.handle, avatarUrl: null },
    lastMessage: { id: idAgent * 1000 + 12, role: 'agent', preview: `${a.displayName} mensaje 12`, createdAt: hace(5) },
    unreadCount: 0,
    agentStatus: { state: 'idle', label: null, updatedAt: hace(0) },
    agentStatuses: [],
  };
}

/** Histórico de 12 mensajes por hilo, alternando persona y agente. */
function historial(idAgent: number) {
  const a = AGENTES.find((x) => x.idAgent === idAgent)!;
  return Array.from({ length: 12 }, (_, i) => ({
    id: idAgent * 1000 + i + 1,
    role: i % 2 === 0 ? 'user' : 'agent',
    body: `${a.displayName} mensaje ${i + 1}`,
    createdAt: hace(60 - i),
    deliveredAt: hace(60 - i),
    readAt: hace(1),
    attachments: [],
    author: null,
    replyTo: null,
  }));
}

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({
    secret: SECRET!,
    token: { email: USUARIO.email, name: USUARIO.name, sub: USUARIO.id, kronosUserId: USUARIO.id, role: 'user' },
  });
  const u = new URL(baseURL);
  await context.addCookies([
    { name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}

/**
 * Chat simulado. `pendientes` deja encolar mensajes que el próximo sondeo del
 * hilo entrega (para probar que SOLO eso se anima).
 */
async function simularChat(page: Page) {
  const pendientes = new Map<number, ReturnType<typeof historial>>();
  let sondeos = 0;

  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: { ...USUARIO }, expires: '2099-01-01T00:00:00Z' } })
  );
  await page.route('**/api/chat/access', (r) =>
    r.fulfill({
      json: {
        canUseChat: true,
        canBroadcast: false,
        canCreateGroups: false,
        canMessagePeople: false,
        companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
        agents: AGENTES,
      },
    })
  );
  await page.route('**/api/chat/conversations', async (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ json: { conversations: [directa(1), directa(2)] } });
    }
    const { idAgent } = r.request().postDataJSON() as { idAgent: number };
    return r.fulfill({ json: { conversation: directa(idAgent) } });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/messages/, (r) => {
    const id = Number(/conversations\/(\d+)\//.exec(r.request().url())![1]);
    // El endpoint devuelve del más nuevo al más viejo.
    return r.fulfill({ json: { messages: historial(id - 100).reverse(), hasMore: false, nextCursor: null } });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/poll/, (r) => {
    sondeos += 1;
    const id = Number(/conversations\/(\d+)\//.exec(r.request().url())![1]);
    const after = Number(new URL(r.request().url()).searchParams.get('after') ?? 0);
    const nuevos = pendientes.get(id) ?? [];
    pendientes.delete(id);
    return r.fulfill({
      json: {
        messages: nuevos,
        cursor: nuevos.length ? nuevos[nuevos.length - 1].id : after,
        hasMore: false,
        status: { state: 'idle', label: null, updatedAt: new Date().toISOString() },
        statuses: [],
        nextPollMs: 700,
        serverTime: new Date().toISOString(),
      },
    });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/read/, (r) => r.fulfill({ json: {} }));
  await page.route('**/api/chat/pins', (r) => r.fulfill({ json: { pins: [], available: true } }));
  await page.route('**/api/chat/pulse**', (r) => r.fulfill({ status: 403, json: {} }));
  await page.route('**/api/correo/agente/acciones**', (r) => r.fulfill({ json: { acciones: [] } }));
  await page.route('**/api/profile/start-page', (r) => r.fulfill({ json: { available: false, options: [], current: null } }));

  return {
    encolar: (idConversation: number, mensajes: ReturnType<typeof historial>) =>
      pendientes.set(idConversation, mensajes),
    sondeos: () => sondeos,
  };
}

/**
 * Registro de lo que cambia en el DOM del hilo. Se instala antes de cargar la
 * página y se lee/reinicia con `medir()`.
 */
async function instalarMedidor(page: Page) {
  await page.addInitScript(() => {
    type Registro = {
      montadas: number;
      desmontadas: number;
      nuevas: string[];
      esqueletos: number;
      cuadrosMezclados: string[];
    };
    const w = window as unknown as { __hilo: Registro };
    w.__hilo = { montadas: 0, desmontadas: 0, nuevas: [], esqueletos: 0, cuadrosMezclados: [] };
    const burbujas = (n: Node) => {
      if (!(n instanceof Element)) return [] as Element[];
      const dentro = Array.from(n.querySelectorAll('.chat-bubble'));
      return n.matches('.chat-bubble') ? [n, ...dentro] : dentro;
    };
    const iniciar = () => {
      new MutationObserver((cambios) => {
        for (const c of cambios) {
          for (const n of Array.from(c.addedNodes)) {
            const b = burbujas(n);
            w.__hilo.montadas += b.length;
            for (const x of b) {
              if (x.classList.contains('chat-bubble--nueva')) w.__hilo.nuevas.push((x.textContent ?? '').slice(0, 40));
            }
            if (n instanceof Element && n.closest('.chat-thread__scroll') && n.querySelector('.mantine-Skeleton-root')) {
              w.__hilo.esqueletos += 1;
            }
          }
          for (const n of Array.from(c.removedNodes)) w.__hilo.desmontadas += burbujas(n).length;
        }
      }).observe(document.documentElement, { childList: true, subtree: true });

      // Cada cuadro: ¿el encabezado dice un agente y las burbujas son de otro?
      const cuadro = () => {
        const cabecera = document.querySelector('.chat-panel__header')?.textContent ?? '';
        const textos = Array.from(document.querySelectorAll('.chat-thread .chat-bubble')).map((b) => b.textContent ?? '');
        for (const nombre of ['Orus', 'Mark']) {
          const otro = nombre === 'Orus' ? 'Mark' : 'Orus';
          if (cabecera.includes(nombre) && textos.some((t) => t.includes(`${otro} mensaje`))) {
            w.__hilo.cuadrosMezclados.push(`${nombre} con burbujas de ${otro}`);
          }
        }
        requestAnimationFrame(cuadro);
      };
      requestAnimationFrame(cuadro);
    };
    if (document.documentElement) iniciar();
    else document.addEventListener('DOMContentLoaded', iniciar);
  });
}

async function medir(page: Page, reiniciar = true) {
  return page.evaluate((r) => {
    const w = window as unknown as {
      __hilo: { montadas: number; desmontadas: number; nuevas: string[]; esqueletos: number; cuadrosMezclados: string[] };
    };
    const copia = JSON.parse(JSON.stringify(w.__hilo));
    if (r) w.__hilo = { montadas: 0, desmontadas: 0, nuevas: [], esqueletos: 0, cuadrosMezclados: [] };
    return copia as typeof w.__hilo;
  }, reiniciar);
}

const hilo = (page: Page) => page.locator('.chat-thread').first();

for (const pantalla of [
  { nombre: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
  { nombre: 'celular', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const) {
  test.describe(`Chat · hilo sin parpadeo · ${pantalla.nombre}`, () => {
    test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
    test.use(pantalla.use);

    test.beforeEach(async ({ context, baseURL, page }) => {
      await sesion(context, baseURL!);
      await instalarMedidor(page);
    });

    test('cambiar de conversación no anima el historial ni deja ver el hilo anterior', async ({ page }) => {
      await simularChat(page);
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('Orus mensaje 12')).toBeVisible();
      await page.waitForTimeout(800);
      await medir(page);

      // Escritorio: desde la columna de la izquierda, SIN desmontar el hilo
      // (es el mismo ChatThread con otro agente). Celular: flecha de volver
      // y tocar al otro asistente en la lista.
      const abrir = async (nombre: string) => {
        if (pantalla.nombre === 'celular') {
          await page.getByRole('button', { name: 'Cerrar la conversación' }).click();
        }
        await page.getByRole('button', { name: `Abrir el chat con ${nombre}` }).first().click();
      };

      await abrir('Mark');
      await expect(hilo(page).getByText('Mark mensaje 12')).toBeVisible();
      await page.waitForTimeout(800);
      const aMark = await medir(page);
      expect(aMark.cuadrosMezclados, 'cuadros con el encabezado de Mark y mensajes de Orus').toEqual([]);
      expect(aMark.nuevas, 'burbujas del historial que entran como «nuevas»').toEqual([]);
      expect(aMark.esqueletos).toBe(0);
      await expect(hilo(page).locator('.chat-bubble--nueva')).toHaveCount(0);

      // Volver a Orus (sale de la caché): tampoco.
      await abrir('Orus');
      await expect(hilo(page).getByText('Orus mensaje 12')).toBeVisible();
      await page.waitForTimeout(800);
      const aOrus = await medir(page);
      expect(aOrus.cuadrosMezclados).toEqual([]);
      expect(aOrus.nuevas).toEqual([]);
      expect(aOrus.esqueletos).toBe(0);
    });

    if (pantalla.nombre === 'escritorio') {
      test('el panel flotante de la barra lateral tampoco anima el historial al cambiar de agente', async ({ page }) => {
        await simularChat(page);
        await page.goto('/process');
        const barra = page.getByRole('complementary', { name: 'Chats' });
        await barra.getByRole('button', { name: /Chat con Orus/ }).click();
        await expect(hilo(page).getByText('Orus mensaje 12')).toBeVisible();
        await page.waitForTimeout(800);
        await medir(page);

        await barra.getByRole('button', { name: /Chat con Mark/ }).click();
        await expect(hilo(page).getByText('Mark mensaje 12')).toBeVisible();
        await page.waitForTimeout(800);
        const aMark = await medir(page);
        expect(aMark.nuevas, 'burbujas del historial que entran como «nuevas»').toEqual([]);
        await expect(hilo(page).locator('.chat-bubble--nueva')).toHaveCount(0);
      });
    }

    test('el sondeo sin novedades no toca las burbujas, y lo que llega solo anima eso', async ({ page }) => {
      const chat = await simularChat(page);
      await page.goto('/process/chat?agent=horus');
      await expect(hilo(page).getByText('Orus mensaje 12')).toBeVisible();
      await page.waitForTimeout(800);
      await medir(page);

      // Varias vueltas del sondeo (cada 700 ms) sin nada nuevo.
      const antes = chat.sondeos();
      await page.waitForTimeout(3_000);
      expect(chat.sondeos() - antes).toBeGreaterThanOrEqual(3);
      // Volver a la pestaña (visibilitychange) también pide sondeo y bandeja.
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(800);
      const quieto = await medir(page);
      expect(quieto.desmontadas, 'burbujas desmontadas por el sondeo').toBe(0);
      expect(quieto.montadas, 'burbujas montadas por el sondeo').toBe(0);
      expect(quieto.esqueletos).toBe(0);

      // Llega UNA respuesta: solo esa entra animada y nada se desmonta.
      chat.encolar(101, [
        { ...historial(1)[11], id: 1013, role: 'agent', body: 'Orus mensaje 13', createdAt: new Date().toISOString() },
      ]);
      await expect(hilo(page).getByText('Orus mensaje 13')).toBeVisible();
      await page.waitForTimeout(500);
      const llegada = await medir(page);
      expect(llegada.desmontadas).toBe(0);
      expect(llegada.montadas).toBe(1);
      expect(llegada.nuevas).toHaveLength(1);
      expect(llegada.nuevas[0]).toContain('Orus mensaje 13');
    });
  });
}
