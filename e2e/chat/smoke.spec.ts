import { expect, test } from '@playwright/test';

/**
 * Barra lateral del chat · humo SIN sesión: las anclas son de cada persona y
 * la ruta nunca responde sin sesión.
 */
test.describe('Chat · barra lateral · humo sin sesión', () => {
  test('la API de anclas responde 401 sin sesión (GET y PUT)', async ({ request }) => {
    expect((await request.get('/api/chat/pins')).status()).toBe(401);
    const put = await request.put('/api/chat/pins', { data: { key: 'agent:1', pinned: true } });
    expect(put.status()).toBe(401);
  });
});
