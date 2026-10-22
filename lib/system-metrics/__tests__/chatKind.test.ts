import { describe, expect, it, vi } from 'vitest';
import { ChatKindCache, chatKindOf } from '../chatKind';

describe('chatKindOf', () => {
  it('"people" es entre personas; directo, grupo y proyecto son con agentes', () => {
    expect(chatKindOf('people')).toBe('people');
    expect(chatKindOf('direct')).toBe('ai');
    expect(chatKindOf('group')).toBe('ai');
    expect(chatKindOf('project')).toBe('ai');
    expect(chatKindOf(null)).toBeNull();
  });
});

describe('ChatKindCache', () => {
  it('consulta una sola vez por conversación y lo recuerda', async () => {
    const lookup = vi.fn(async () => 'direct');
    const cache = new ChatKindCache(lookup);
    const target = { table: 'conversation' as const, id: 7 };

    expect(cache.peek(target)).toBeUndefined();
    const [a, b] = await Promise.all([cache.resolve(target), cache.resolve(target)]);
    expect([a, b]).toEqual(['ai', 'ai']);
    expect(cache.peek(target)).toBe('ai');
    await cache.resolve(target);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('si la consulta falla cuenta como Chat y no reintenta durante la pausa', async () => {
    let now = 0;
    const lookup = vi.fn(async () => {
      throw new Error('sin tabla');
    });
    const cache = new ChatKindCache(lookup, () => now);
    const target = { table: 'attachment' as const, id: 3 };

    expect(await cache.resolve(target)).toBeNull();
    expect(await cache.resolve({ table: 'conversation', id: 9 })).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);

    now = 11 * 60_000;
    await cache.resolve(target);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
