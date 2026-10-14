import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeAutofilledEmail, sgcNoAutofill, sgcSignaturePasswordProps, SGC_SIGNATURE_PASSWORD_FIELD } from '../autofill';

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

  it('la contraseña de la firma no se autocompleta: new-password, nombre no estándar y marcas de los gestores', () => {
    const p = sgcSignaturePasswordProps();
    expect(p.autoComplete).toBe('new-password');
    expect(p.name).toBe(SGC_SIGNATURE_PASSWORD_FIELD);
    expect(p.id).toBe(SGC_SIGNATURE_PASSWORD_FIELD);
    expect(p.name).not.toMatch(/^(password|current-password|pass|pwd)$/i);
    expect(p).toMatchObject({ 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true' });
  });
  it('el modal de firma usa esas props, arranca de solo lectura y no pide current-password', () => {
    const src = readFileSync(join(__dirname, '../../../components/sgc/signature/SgcSignModal.tsx'), 'utf8');
    expect(src).not.toContain('current-password');
    expect(src).toContain('{...sgcSignaturePasswordProps()}');
    expect(src).toMatch(/readOnly=\{!passwordUnlocked\}/);
    expect(src).toMatch(/onFocus=\{\(\) => setPasswordUnlocked\(true\)\}/);
  });
});
