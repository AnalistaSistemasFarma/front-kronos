import { afterEach, describe, expect, it } from 'vitest';
import { isInSandboxFolder, isOneDriveSandbox, oneDriveRoot } from '../root';

const original = process.env.ONEDRIVE_ROOT_FOLDER;

afterEach(() => {
  if (original === undefined) delete process.env.ONEDRIVE_ROOT_FOLDER;
  else process.env.ONEDRIVE_ROOT_FOLDER = original;
});

describe('oneDriveRoot / isOneDriveSandbox', () => {
  it('sin variable usa SAPSEND (producción) y no es zona de pruebas', () => {
    delete process.env.ONEDRIVE_ROOT_FOLDER;
    expect(oneDriveRoot()).toBe('SAPSEND');
    expect(isOneDriveSandbox()).toBe(false);
  });

  it('con la variable usa esa carpeta y sí es zona de pruebas', () => {
    process.env.ONEDRIVE_ROOT_FOLDER = 'SAPSEND-PRUEBAS';
    expect(oneDriveRoot()).toBe('SAPSEND-PRUEBAS');
    expect(isOneDriveSandbox()).toBe(true);
  });

  it('SAPSEND escrito de otra forma sigue siendo producción', () => {
    process.env.ONEDRIVE_ROOT_FOLDER = 'sapsend';
    expect(isOneDriveSandbox()).toBe(false);
  });

  it('ignora valores con barras o caracteres raros y cae a SAPSEND', () => {
    process.env.ONEDRIVE_ROOT_FOLDER = '../SAPSEND';
    expect(oneDriveRoot()).toBe('SAPSEND');
    process.env.ONEDRIVE_ROOT_FOLDER = 'A/B';
    expect(oneDriveRoot()).toBe('SAPSEND');
    expect(isOneDriveSandbox()).toBe(false);
  });
});

describe('isInSandboxFolder', () => {
  const sandbox = ['SAPSEND-PRUEBAS', 'TEC', 'SG', 'Request-10054'];

  it('acepta un archivo exactamente en la carpeta de pruebas', () => {
    expect(isInSandboxFolder('/drive/root:/SAPSEND-PRUEBAS/TEC/SG/Request-10054', sandbox)).toBe(true);
  });

  it('rechaza la carpeta real con el mismo número de solicitud', () => {
    expect(isInSandboxFolder('/drive/root:/SAPSEND/TEC/SG/Request-10054', sandbox)).toBe(false);
  });

  it('rechaza otra solicitud y subcarpetas', () => {
    expect(isInSandboxFolder('/drive/root:/SAPSEND-PRUEBAS/TEC/SG/Request-100541', sandbox)).toBe(false);
    expect(isInSandboxFolder('/drive/root:/SAPSEND-PRUEBAS/TEC/SG/Request-10054/otra', sandbox)).toBe(false);
  });

  it('nunca acepta si la raíz es la de producción', () => {
    const prod = ['SAPSEND', 'TEC', 'SG', 'Request-10054'];
    expect(isInSandboxFolder('/drive/root:/SAPSEND/TEC/SG/Request-10054', prod)).toBe(false);
  });

  it('rechaza rutas vacías', () => {
    expect(isInSandboxFolder(undefined, sandbox)).toBe(false);
    expect(isInSandboxFolder('', sandbox)).toBe(false);
  });
});
