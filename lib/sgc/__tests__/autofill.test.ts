import { describe, expect, it } from 'vitest';
import { looksLikeAutofilledEmail, sgcNoAutofill } from '../autofill';

describe('SGC · autocompletado del navegador', () => {
  it('los campos libres no se autocompletan y su nombre no parece «usuario»', () => {
    const p = sgcNoAutofill('signature-reason');
    expect(p).toMatchObject({ name: 'sgc-signature-reason', autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true' });
    expect(p.name).not.toMatch(/user|email|correo|login/i);
  });
  it('detecta el correo del usuario rellenado en un campo de texto', () => {
    expect(looksLikeAutofilledEmail(' Nicolas.Rivera@gsslatam.com ', 'nicolas.rivera@gsslatam.com')).toBe(true);
    expect(looksLikeAutofilledEmail('Revisado sin observaciones', 'nicolas.rivera@gsslatam.com')).toBe(false);
    expect(looksLikeAutofilledEmail('nicolas.rivera@gsslatam.com', null)).toBe(false);
  });
});
