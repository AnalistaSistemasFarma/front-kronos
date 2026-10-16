import { describe, expect, it } from 'vitest';
import { agentAvatarSrc } from '../../chat/client';

describe('agentAvatarSrc con avatar estilo Notion', () => {
  const notion = '/api/avatar/agent/horus?v=2000';

  it('el avatar Notion gana si es más reciente que la foto subida', () => {
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: notion, avatarVersion: 1000 })).toBe(notion);
  });

  it('la foto subida gana si se subió DESPUÉS del avatar Notion', () => {
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: notion, avatarVersion: 3000 })).toBe(
      '/api/chat/agents/horus/avatar?v=3000'
    );
  });

  it('sin foto subida se usa el avatar Notion', () => {
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: notion, avatarVersion: null })).toBe(notion);
  });

  it('el comportamiento de siempre no cambia', () => {
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: '/agents/orus.png', avatarVersion: 5 })).toBe(
      '/api/chat/agents/horus/avatar?v=5'
    );
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: '/agents/orus.png', avatarVersion: null })).toBe('/agents/orus.png');
    expect(agentAvatarSrc({ code: 'horus', avatarUrl: null })).toBeNull();
  });
});
