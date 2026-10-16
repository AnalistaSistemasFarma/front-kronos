import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { withSgcAppLock } from '../../../lib/sgc/db/lock';

/**
 * Sprint 6 contra un SQL Server REAL (efímero en CI): protección del esquema
 * validado `sgc` (migración 20261001200000_sgc_s6_endurecimiento).
 *
 * - TRUNCATE y DROP de los registros de solo inserción fallan siempre (tabla
 *   de protección con claves foráneas), aun declarando el cambio controlado.
 * - Los cambios destructivos de estructura en `sgc` se rechazan sin control
 *   de cambios declarado; con él se permiten y quedan en sgc.ddl_event_log,
 *   que es de solo inserción.
 * - El DDL de `dbo` (el resto de SynerLink) no se ve afectado.
 * - El bloqueo con nombre (sp_getapplock) serializa entre conexiones.
 *
 * Cada sentencia que declara el cambio controlado va en UN SOLO lote, porque
 * el contexto de sesión es por conexión y Prisma usa un grupo de conexiones.
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 6 · protección del esquema validado con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CONTROL = `EXEC sp_set_session_context N'sgc_ddl_autorizado', 1; EXEC sp_set_session_context N'sgc_ddl_motivo', N'Prueba de integración S6';`;
  const FIN = `EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL; EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;`;

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`${CONTROL} IF OBJECT_ID(N'sgc.zz_s6_it', N'U') IS NOT NULL DROP TABLE sgc.zz_s6_it; ${FIN}`).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-089] la migración del S6 deja la tabla de protección, el registro de DDL, el trigger de base de datos y los índices', async () => {
    const objs = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.objects WHERE schema_id = SCHEMA_ID('sgc') AND name IN ('proteccion_registros','ddl_event_log','ddl_event_log_solo_insercion') ORDER BY name`;
    expect(objs.map((o) => o.name)).toEqual(['ddl_event_log', 'ddl_event_log_solo_insercion', 'proteccion_registros']);
    const trg = await prisma.$queryRaw<{ is_disabled: boolean }[]>`SELECT is_disabled FROM sys.triggers WHERE parent_class = 0 AND name = 'sgc_proteger_esquema'`;
    expect(trg).toEqual([{ is_disabled: false }]);
    const idx = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.indexes WHERE name IN ('signature_cadena_prev_uq','signature_cadena_genesis_uq','IX_sgc_audit_log_actor_email_action_occurred_at','IX_sgc_request_id_document_status','IX_sgc_review_alert_id_document_version_alert_key') ORDER BY name`;
    expect(idx).toHaveLength(5);
    expect(Number((await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sgc.proteccion_registros`)[0].n)).toBe(0);
  });

  it('[SGC-REQ-089] TRUNCATE y DROP de la auditoría, las firmas y el historial fallan, aun con el cambio declarado', async () => {
    for (const t of ['audit_log', 'signature', 'interaction', 'config_change_log', 'signature_consent', 'quality_check', 'draft_revision', 'training_upload', 'training_result', 'review_alert']) {
      await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE sgc.${t}`)).rejects.toThrow(/FOREIGN KEY/i);
    }
    // El contexto se limpia en el mismo lote aunque falle (la conexión vuelve al grupo).
    await expect(prisma.$executeRawUnsafe(`BEGIN TRY ${CONTROL} DROP TABLE sgc.audit_log; END TRY BEGIN CATCH ${FIN} THROW; END CATCH`)).rejects.toThrow(/FOREIGN KEY/i);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO sgc.proteccion_registros (id) VALUES (1)`)).rejects.toThrow(/siempre_vacia/);
  });

  it('[SGC-REQ-089] un cambio destructivo de estructura en sgc se RECHAZA sin control de cambios y, declarado, queda registrado', async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE sgc.zz_s6_it (id INT NOT NULL PRIMARY KEY)`);
    await expect(prisma.$executeRawUnsafe(`ALTER TABLE sgc.zz_s6_it ADD x INT NULL`)).rejects.toThrow(/RECHAZADO/);
    await expect(prisma.$executeRawUnsafe(`DROP TABLE sgc.zz_s6_it`)).rejects.toThrow(/RECHAZADO/);
    await expect(prisma.$executeRawUnsafe(`ALTER TABLE sgc.document ADD zz_s6 INT NULL`)).rejects.toThrow(/RECHAZADO/);
    await prisma.$executeRawUnsafe(`${CONTROL} ALTER TABLE sgc.zz_s6_it ADD x INT NULL; DROP TABLE sgc.zz_s6_it; ${FIN}`);
    const log = await prisma.$queryRaw<{ event_type: string; authorized: boolean; motivo: string | null }[]>`
      SELECT event_type, authorized, motivo FROM sgc.ddl_event_log WHERE object_name = 'zz_s6_it' ORDER BY id_ddl_event`;
    expect(log.map((l) => [l.event_type, l.authorized])).toEqual([
      ['CREATE_TABLE', false],
      ['ALTER_TABLE', true],
      ['DROP_TABLE', true],
    ]);
    expect(log[2].motivo).toBe('Prueba de integración S6');
    // El registro de cambios de estructura no se modifica ni se borra.
    await expect(prisma.$executeRawUnsafe(`UPDATE sgc.ddl_event_log SET motivo = N'x'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM sgc.ddl_event_log`)).rejects.toThrow(/solo inserción/);
  });

  it('[SGC-REQ-089] el DDL del resto de SynerLink (dbo) no se ve afectado ni se registra', async () => {
    const before = Number((await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sgc.ddl_event_log`)[0].n);
    await prisma.$executeRawUnsafe(`CREATE TABLE dbo.zz_s6_it_dbo (id INT); ALTER TABLE dbo.zz_s6_it_dbo ADD y INT NULL; DROP TABLE dbo.zz_s6_it_dbo;`);
    expect(Number((await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sgc.ddl_event_log`)[0].n)).toBe(before);
  });

  it('[SGC-REQ-087] el bloqueo con nombre serializa entre conexiones: mientras uno genera, el otro recibe «ya se está generando»', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const first = withSgcAppLock(prisma, 'sgc-it-s6-lock', { waitMs: 0, busyMessage: 'ocupado' }, async () => {
      entered();
      await held;
      return 'primero';
    });
    await inside;
    await expect(withSgcAppLock(prisma, 'sgc-it-s6-lock', { waitMs: 0, busyMessage: 'Ya se está generando' }, async () => 'segundo')).rejects.toMatchObject({ status: 409, message: 'Ya se está generando' });
    release();
    await expect(first).resolves.toBe('primero');
    // Liberado el primero, el siguiente entra.
    await expect(withSgcAppLock(prisma, 'sgc-it-s6-lock', { waitMs: 0, busyMessage: 'ocupado' }, async () => 'después')).resolves.toBe('después');
  });
});
