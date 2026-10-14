import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeAutofilledEmail, sgcFieldNonce, sgcMaskedInputStyle, sgcNoAutofill, sgcSignaturePasswordProps, supportsTextSecurity, SGC_SIGNATURE_PASSWORD_FIELD } from '../autofill';

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

  it('[SGC-REQ-151] la contraseña de la firma no se autocompleta: campo de TEXTO enmascarado (sin type=password), nombre único y marcas de los gestores', () => {
    const p = sgcSignaturePasswordProps({ nonce: 'abc12345', textSecurity: true });
    expect(p).toMatchObject({ type: 'text', autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false });
    expect(p.name).toBe(`${SGC_SIGNATURE_PASSWORD_FIELD}-abc12345`);
    expect(p.id).toBe(p.name);
    expect(p.name).not.toMatch(/password|clave|pass|pwd|user|email|login/i);
    expect(p).toMatchObject({ 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' });
    expect(sgcMaskedInputStyle(true, true)).toEqual({ WebkitTextSecurity: 'disc' });
    expect(sgcMaskedInputStyle(true, false)).toEqual({ WebkitTextSecurity: 'none' });
  });
  it('[SGC-REQ-151] respaldo sin texto enmascarado: type=password con new-password (nunca current-password)', () => {
    const p = sgcSignaturePasswordProps({ nonce: 'x', textSecurity: false });
    expect(p).toMatchObject({ type: 'password', autoComplete: 'new-password' });
    expect(sgcMaskedInputStyle(false, true)).toBeUndefined();
  });
  it('[SGC-REQ-151] detecta el soporte de -webkit-text-security y el nombre cambia en cada apertura', () => {
    expect(supportsTextSecurity({ supports: (prop, value) => prop === '-webkit-text-security' && value === 'disc' })).toBe(true);
    expect(supportsTextSecurity({ supports: () => false })).toBe(false);
    expect(supportsTextSecurity(undefined)).toBe(false);
    expect(supportsTextSecurity({ supports: () => { throw new Error('x'); } })).toBe(false);
    let n = 0;
    const seq = () => [0.123456789, 0.987654321][n++ % 2];
    const a = sgcFieldNonce(seq);
    const b = sgcFieldNonce(seq);
    expect(a).toHaveLength(8);
    expect(a).not.toBe(b);
  });
  it('[SGC-REQ-151] el modal de firma: sin PasswordInput ni current-password, solo lectura hasta tocarlo, usuario explícito solo en el respaldo', () => {
    const src = readFileSync(join(__dirname, '../../../components/sgc/signature/SgcSignModal.tsx'), 'utf8');
    expect(src).not.toContain('current-password');
    expect(src).not.toContain('PasswordInput');
    expect(src).toContain('sgcSignaturePasswordProps({ nonce, textSecurity: textSecurity !== false })');
    expect(src).toMatch(/readOnly=\{!passwordUnlocked\}/);
    expect(src).toMatch(/onFocus=\{\(\) => setPasswordUnlocked\(true\)\}/);
    expect(src).toMatch(/\{textSecurity === false && \(\s*<input\s+type='email'/);
    expect(src).toContain('if (opened) setNonce(sgcFieldNonce())');
  });
});
