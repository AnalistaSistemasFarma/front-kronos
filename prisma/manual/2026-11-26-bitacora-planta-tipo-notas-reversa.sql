/*
  REVERSA — Bitácora de Proceso: planta, tipo de personal y notas (2026-11-26).
  ⚠️ Antes de correrla, devuelva el CÓDIGO anterior (el nuevo usa estas columnas). Borra las notas
  de corrección escritas: respáldelas antes si hay alguna (SELECT * FROM dbo.ot_registro_nota).
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51522, N'Base no esperada.', 1;
GO
IF OBJECT_ID(N'dbo.TR_ot_registro_nota_inmutable', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_ot_registro_nota_inmutable];
IF OBJECT_ID(N'dbo.ot_registro_nota', N'U') IS NOT NULL DROP TABLE [dbo].[ot_registro_nota];
IF OBJECT_ID(N'dbo.CK_ot_operador_tipo', N'C') IS NOT NULL ALTER TABLE [dbo].[ot_operador] DROP CONSTRAINT [CK_ot_operador_tipo];
IF OBJECT_ID(N'dbo.ot_operador_tipo_df', N'D') IS NOT NULL ALTER TABLE [dbo].[ot_operador] DROP CONSTRAINT [ot_operador_tipo_df];
IF COL_LENGTH(N'dbo.ot_operador', N'tipo') IS NOT NULL ALTER TABLE [dbo].[ot_operador] DROP COLUMN [tipo];
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta_asignada_en') IS NOT NULL ALTER TABLE [dbo].[ot_orden_trabajo] DROP COLUMN [planta_asignada_en];
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta_asignada_por') IS NOT NULL ALTER TABLE [dbo].[ot_orden_trabajo] DROP COLUMN [planta_asignada_por];
IF OBJECT_ID(N'dbo.CK_ot_orden_trabajo_planta', N'C') IS NOT NULL ALTER TABLE [dbo].[ot_orden_trabajo] DROP CONSTRAINT [CK_ot_orden_trabajo_planta];
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'planta') IS NOT NULL ALTER TABLE [dbo].[ot_orden_trabajo] DROP COLUMN [planta];
