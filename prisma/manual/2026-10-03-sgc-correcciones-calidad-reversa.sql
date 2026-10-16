/*
  REVERSA de la migración 20261003120000_sgc_correcciones_calidad (SGC,
  correcciones de Calidad OLP del 2026-10-02) y de sus datos
  (prisma/manual/2026-10-03-sgc-correcciones-calidad-olp.sql).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 6: quita las tablas
  document_layout y read_threshold_notice (con sus triggers), las columnas
  nuevas de company_config, document_version y draft_revision (con sus CHECK y
  DEFAULT) y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior (Prisma lee
  estas columnas). ⚠️ Se pierden la ubicación de firmas, los avisos de umbral,
  el logo y los dominios configurados y el motivo de las revisiones menores:
  exportarlos antes si se necesitan como evidencia. Una revisión menor ya
  guardada queda como revisión normal (su motivo se pierde): por eso la reversa
  se niega a correr si existe alguna, salvo que se declare
  sgc_reversa_revisiones_menores = 1 en la sesión.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

IF COL_LENGTH(N'sgc.draft_revision', N'minor_reason') IS NOT NULL
   AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_revisiones_menores') AS INT) IS NULL
BEGIN
  DECLARE @menores INT;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[draft_revision] WHERE [minor_reason] IS NOT NULL', N'@n INT OUTPUT', @n = @menores OUTPUT;
  IF @menores > 0
    THROW 51052, N'Hay revisiones menores de Calidad registradas: exporte sgc.draft_revision y declare sgc_reversa_revisiones_menores = 1 antes de la reversa.', 1;
END;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261003120000_sgc_correcciones_calidad';

IF OBJECT_ID(N'[sgc].[document_layout_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[document_layout_solo_insercion];
IF OBJECT_ID(N'[sgc].[document_layout]', N'U') IS NOT NULL
  DROP TABLE [sgc].[document_layout];

IF OBJECT_ID(N'[sgc].[read_threshold_notice_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[read_threshold_notice_solo_insercion];
IF OBJECT_ID(N'[sgc].[read_threshold_notice]', N'U') IS NOT NULL
  DROP TABLE [sgc].[read_threshold_notice];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'draft_revision_menor_ck')
  ALTER TABLE [sgc].[draft_revision] DROP CONSTRAINT [draft_revision_menor_ck];
IF COL_LENGTH(N'sgc.draft_revision', N'minor_reason') IS NOT NULL
  ALTER TABLE [sgc].[draft_revision] DROP COLUMN [minor_reason];
IF COL_LENGTH(N'sgc.draft_revision', N'base_sha256') IS NOT NULL
  ALTER TABLE [sgc].[draft_revision] DROP COLUMN [base_sha256];

IF COL_LENGTH(N'sgc.document_version', N'layout_json') IS NOT NULL
  ALTER TABLE [sgc].[document_version] DROP COLUMN [layout_json];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_read_threshold_ck')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_read_threshold_ck];
DECLARE @df SYSNAME = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = N'read_threshold_pct');
IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df + N']');
IF COL_LENGTH(N'sgc.company_config', N'read_threshold_pct') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [read_threshold_pct];
IF COL_LENGTH(N'sgc.company_config', N'dissemination_domains') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [dissemination_domains];
IF COL_LENGTH(N'sgc.company_config', N'logo_data_url') IS NOT NULL
  ALTER TABLE [sgc].[company_config] DROP COLUMN [logo_data_url];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261003120000_sgc_correcciones_calidad';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
