import { describe, expect, it } from 'vitest';
import { isNewBuild } from './buildId';

describe('isNewBuild', () => {
  it('detecta un build distinto', () => {
    expect(isNewBuild('a', 'b')).toBe(true);
    expect(isNewBuild('a', 'a')).toBe(false);
    expect(isNewBuild('', 'b')).toBe(false);
    expect(isNewBuild('a', null)).toBe(false);
  });
});
