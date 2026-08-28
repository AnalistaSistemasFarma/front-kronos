import { describe, it, expect, vi } from 'vitest';
import {
  cleanModuleName,
  parseModuleId,
  resolveModuleProcessId,
} from '../modules';
import { CUSTOM_VIEWS_PROCESS_ID } from '../access';

describe('cleanModuleName', () => {
  it('recorta y colapsa espacios', () => {
    expect(cleanModuleName('  Reportes   de  Tesorería ')).toBe('Reportes de Tesorería');
  });
  it('no-string → cadena vacía', () => {
    expect(cleanModuleName(undefined)).toBe('');
    expect(cleanModuleName(123)).toBe('');
    expect(cleanModuleName(null)).toBe('');
  });
});

describe('parseModuleId', () => {
  it('acepta enteros positivos', () => {
    expect(parseModuleId(13)).toBe(13);
    expect(parseModuleId('7')).toBe(7);
  });
  it('rechaza 0, negativos, no numéricos', () => {
    expect(parseModuleId(0)).toBeNull();
    expect(parseModuleId(-1)).toBeNull();
    expect(parseModuleId('abc')).toBeNull();
    expect(parseModuleId(1.5)).toBeNull();
    expect(parseModuleId(undefined)).toBeNull();
  });
});

/** Fake mínimo de Prisma para probar resolveModuleProcessId sin BD. */
function fakePrisma(opts: {
  existingByName?: { id_process: number } | null;
  existingById?: { id_process: number } | null;
  createdId?: number;
}) {
  const findFirst = vi.fn(async () => opts.existingByName ?? null);
  const findUnique = vi.fn(async () => opts.existingById ?? null);
  const create = vi.fn(async () => ({ id_process: opts.createdId ?? 99 }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { process: { findFirst, findUnique, create } } as any;
}

describe('resolveModuleProcessId', () => {
  it('sin selección → módulo por defecto (13)', async () => {
    const prisma = fakePrisma({});
    const id = await resolveModuleProcessId(prisma, {});
    expect(id).toBe(CUSTOM_VIEWS_PROCESS_ID);
  });

  it('targetProcessId existente → lo usa', async () => {
    const prisma = fakePrisma({ existingById: { id_process: 8 } });
    const id = await resolveModuleProcessId(prisma, { targetProcessId: 8 });
    expect(id).toBe(8);
  });

  it('targetProcessId inexistente → lanza error', async () => {
    const prisma = fakePrisma({ existingById: null });
    await expect(resolveModuleProcessId(prisma, { targetProcessId: 999 })).rejects.toThrow();
  });

  it('newCategoryName existente por nombre → reutiliza (idempotente)', async () => {
    const prisma = fakePrisma({ existingByName: { id_process: 21 } });
    const id = await resolveModuleProcessId(prisma, { newCategoryName: 'Reportes' });
    expect(id).toBe(21);
    expect(prisma.process.create).not.toHaveBeenCalled();
  });

  it('newCategoryName nuevo → crea el módulo (process_url null)', async () => {
    const prisma = fakePrisma({ existingByName: null, createdId: 42 });
    const id = await resolveModuleProcessId(prisma, { newCategoryName: 'Nueva Cat' });
    expect(id).toBe(42);
    expect(prisma.process.create).toHaveBeenCalledWith({
      data: { process: 'Nueva Cat', process_url: null },
      select: { id_process: true },
    });
  });

  it('newCategoryName tiene prioridad sobre targetProcessId', async () => {
    const prisma = fakePrisma({ existingByName: { id_process: 30 }, existingById: { id_process: 8 } });
    const id = await resolveModuleProcessId(prisma, {
      newCategoryName: 'X',
      targetProcessId: 8,
    });
    expect(id).toBe(30);
  });
});
