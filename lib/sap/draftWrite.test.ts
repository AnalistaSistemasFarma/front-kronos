import { describe, expect, it } from 'vitest';
import { docKey, isSapConcurrencyConflict, pendingDocLocks, retryOnConflict, withDocLock, writeDoc } from './draftWrite';
import { SapError } from './serviceLayer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const conflict = () =>
  new SapError('PATCH Drafts(878) fallo (400)', 400, '{"error":{"code":-2039,"message":{"value":"Another user or another operation modified data"}}}');

describe('escrituras serializadas por documento SAP', () => {
  it('la clave identifica empresa, entidad y documento', () => {
    expect(docKey(3, 'Drafts', 878)).toBe('3:Drafts:878');
    expect(docKey(3, 'Drafts', 878)).not.toBe(docKey(4, 'Drafts', 878));
  });

  it('dos escrituras sobre el mismo documento no se solapan y respetan el orden de llegada', async () => {
    const log: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const job = (name: string, ms: number) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`${name}:start`);
      await sleep(ms);
      log.push(`${name}:end`);
      inFlight--;
      return name;
    };
    const key = docKey(3, 'Drafts', 1);
    const [a, b] = await Promise.all([withDocLock(key, job('decision', 30)), withDocLock(key, job('tareaSap', 5))]);
    expect([a, b]).toEqual(['decision', 'tareaSap']);
    expect(maxInFlight).toBe(1);
    expect(log).toEqual(['decision:start', 'decision:end', 'tareaSap:start', 'tareaSap:end']);
    expect(pendingDocLocks()).toBe(0);
  });

  it('documentos distintos sí corren en paralelo', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const job = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(15);
      inFlight--;
    };
    await Promise.all([withDocLock(docKey(3, 'Drafts', 1), job), withDocLock(docKey(3, 'Drafts', 2), job)]);
    expect(maxInFlight).toBe(2);
  });

  it('un error de la primera escritura llega a su llamador pero no bloquea la cola', async () => {
    const key = docKey(3, 'Drafts', 3);
    const first = withDocLock(key, async () => {
      throw new Error('falló');
    });
    const second = withDocLock(key, async () => 'ok');
    await expect(first).rejects.toThrow('falló');
    await expect(second).resolves.toBe('ok');
  });

  it('reconoce −2039 y 412 como conflicto de concurrencia; lo demás no', () => {
    expect(isSapConcurrencyConflict(conflict())).toBe(true);
    expect(isSapConcurrencyConflict(new SapError('x', 412))).toBe(true);
    expect(isSapConcurrencyConflict(new SapError('x', 400, '{"error":{"code":-5002,"message":{"value":"Campo inválido"}}}'))).toBe(false);
    expect(isSapConcurrencyConflict(new Error('-2039'))).toBe(false);
    expect(isSapConcurrencyConflict(null)).toBe(false);
  });

  it('reintenta ante −2039 volviendo a ejecutar la lectura + escritura', async () => {
    let calls = 0;
    const retries: number[] = [];
    const r = await retryOnConflict(
      async (attempt) => {
        calls++;
        if (attempt < 3) throw conflict();
        return 'escrito';
      },
      { delayMs: 1, onRetry: (a) => retries.push(a) }
    );
    expect(r).toBe('escrito');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('no reintenta otros errores y se rinde tras el último intento', async () => {
    let calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw new SapError('x', 400, '{"error":{"code":-5002}}');
      }, { delayMs: 1 })
    ).rejects.toBeInstanceOf(SapError);
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      retryOnConflict(async () => {
        calls++;
        throw conflict();
      }, { attempts: 2, delayMs: 1 })
    ).rejects.toThrow('fallo');
    expect(calls).toBe(2);
  });

  it('writeDoc combina cola y reintento', async () => {
    let n = 0;
    const r = await writeDoc(docKey(3, 'Drafts', 9), async () => {
      n++;
      if (n === 1) throw conflict();
      return n;
    }, { delayMs: 1 });
    expect(r).toBe(2);
  });
});
