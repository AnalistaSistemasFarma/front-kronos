/*
  Migration: BITÁCORA DE PROCESO — who assigned/corrected the plant of an open bitácora — 2026-11-26.
  Nicolás: in production there are ~70 open bitácoras opened before the plant existed; supervisors
  must be able to assign (or correct) the plant while the bitácora is OPEN. Closed ones stay as they
  are (TR_ot_orden_trabajo_cerrada).
    dbo.ot_orden_trabajo.planta_asignada_por NVARCHAR(50) NULL  -- user.id of the last assignment
    dbo.ot_orden_trabajo.planta_asignada_en  DATETIME2    NULL  -- server time (UTC)
  NULL when the plant was chosen when opening. Purely ADDITIVE and IDEMPOTENT. Requires
  20261126150000_bitacora_proceso_planta_tipo_notas. Wrappers in prisma/manual/2026-11-26-bitacora-planta-tipo-notas-*.sql.
*/
SET XACT_ABORT ON;
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta_asignada_por') IS NULL
  ALTER TABLE [dbo].[ot_orden_trabajo] ADD [planta_asignada_por] NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta_asignada_en') IS NULL
  ALTER TABLE [dbo].[ot_orden_trabajo] ADD [planta_asignada_en] DATETIME2 NULL;
