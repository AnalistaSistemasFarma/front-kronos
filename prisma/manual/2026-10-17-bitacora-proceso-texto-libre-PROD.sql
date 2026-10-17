/*
  PASE MANUAL (PROD) — Bitácora de Proceso: actividades de TEXTO LIBRE. 2026-10-17.
  BASE: KRONOSDB (producción). El script se detiene en cualquier otra base.

  ⛔ NO CORRER sin el visto bueno explícito de Nicolás Rivera. ORDEN OBLIGATORIO en el pase:
  1) respaldo COPY_ONLY de KRONOSDB, 2) este script, 3) el código (schema.prisma cambia: ventana
  controlada). Si el código sale antes, la Bitácora falla con «Invalid column name 'texto_libre'».
  El script SOLO AGREGA columnas con DEFAULT 0: el código anterior sigue funcionando con ellas.

  QUÉ HACE: el DDL de prisma/migrations/20261017200000_bitacora_proceso_texto_libre, nada más
  (ot_actividad.texto_libre y ot_registro.es_texto_libre, BIT NOT NULL DEFAULT 0). No marca
  ninguna actividad: eso lo hace Gestión desde Catálogo → Actividades.
  Aditivo e IDEMPOTENTE; informa antes y después.

  🔒 BLOQUEOS: ALTER TABLE pide Sch-M. Con LOCK_TIMEOUT 5000 se rinde a los 5 s si la tabla
  está tomada (error 1222) y hace ROLLBACK: vuelva a correrlo.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS.
  REVERSA: prisma/manual/2026-10-17-bitacora-proceso-texto-libre-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51482, N'Base no esperada para este script (PROD).', 1;
IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL OR OBJECT_ID(N'dbo.ot_registro', N'U') IS NULL
  THROW 51483, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') AS actividad_texto_libre,
       COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') AS registro_es_texto_libre;

BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') IS NULL
    ALTER TABLE [dbo].[ot_actividad] ADD [texto_libre] BIT NOT NULL CONSTRAINT [ot_actividad_texto_libre_df] DEFAULT 0;
  IF COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') IS NULL
    ALTER TABLE [dbo].[ot_registro] ADD [es_texto_libre] BIT NOT NULL CONSTRAINT [ot_registro_es_texto_libre_df] DEFAULT 0;
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') AS actividad_texto_libre,
       COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') AS registro_es_texto_libre;
