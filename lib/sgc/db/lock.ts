import type { Prisma } from '../../../app/generated/prisma';
import { SgcError } from '../errors';
import type { SgcDb } from './catalogs';

/**
 * Bloqueo con nombre en SQL Server (`sp_getapplock`) — Sprint 6.
 *
 * Serializa una operación entre TODAS las instancias de la aplicación (las 2
 * de pm2 y cualquier otra), algo que un candado en memoria no logra. El
 * bloqueo vive en una transacción propia que no toca tablas: se libera solo
 * al terminar (o si el proceso muere), así que no queda nada «colgado».
 *
 * Usos: generar el PDF controlado de una solicitud una sola vez a la vez, y
 * contar → comparar → registrar los intentos de reautenticación de una
 * persona sin que una ráfaga en paralelo se salte el bloqueo de 5 intentos.
 *
 * `fn` recibe la transacción que retiene el bloqueo: lo que necesite la base
 * DENTRO de la sección crítica conviene hacerlo con ella (misma conexión).
 * Con espera > 0, cada esperante retiene una conexión del grupo: úsese 0
 * (rechazar si está ocupado) salvo que la espera sea corta y rara.
 */
export async function withSgcAppLock<T>(
  db: SgcDb,
  resource: string,
  opts: { waitMs: number; busyMessage: string; holdMs?: number },
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const name = resource.slice(0, 255);
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ r: number }[]>`
        DECLARE @r INT;
        EXEC @r = sp_getapplock @Resource = ${name}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = ${opts.waitMs};
        SELECT @r AS r;`;
      const r = Number(rows[0]?.r ?? -999);
      if (r < 0) throw new SgcError(opts.busyMessage, 409);
      return fn(tx);
    },
    { maxWait: 15_000, timeout: opts.holdMs ?? 120_000 }
  );
}

/**
 * E2E del 2026-10-10: el CÓDIGO de un documento nuevo (consecutivo de la guía)
 * se calcula como «el mayor existente + 1» y el archivo se sube a OneDrive por
 * RUTA (código/versión) ANTES de crear el documento en la base. Dos generaciones
 * a la vez en la misma empresa (dos aprobaciones finales, o una aprobación y una
 * carga inicial) tomaban el mismo código: la segunda REEMPLAZABA el PDF ya
 * registrado de la primera (que quedaba distinto de su huella) y luego fallaba
 * por la restricción única. Este bloqueo serializa, por empresa, el tramo
 * «calcular código → subir → registrar». Es raro y corto: se espera (no se rechaza).
 */
export function withNewDocumentCodeLock<T>(db: SgcDb, idCompany: number, fn: () => Promise<T>): Promise<T> {
  return withSgcAppLock(
    db,
    `sgc-codigo-documento-nuevo-${idCompany}`,
    { waitMs: 90_000, busyMessage: 'Se está registrando otro documento nuevo de la empresa. Intente de nuevo en un momento.', holdMs: 240_000 },
    () => fn()
  );
}
