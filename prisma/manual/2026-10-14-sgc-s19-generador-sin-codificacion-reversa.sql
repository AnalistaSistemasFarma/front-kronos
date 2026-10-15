/*
  REVERSA de 20261014130000_sgc_s19_generador_sin_codificacion (Sprint 19).
  Quita [sgc].[document_type].[generator_guide] y su DEFAULT.

  ⚠️ SE NIEGA (THROW) sin sgc_reversa_generador_guia = 1 si algún tipo está
  marcado como plantilla guía: el código anterior (PR #587) deja proponer
  plantillas desde CUALQUIER documento codificado, lo que contradice la RN
  R34. Antes de declararla, exporte la lista de tipos marcados.
  Los registros ya generados (sgc.generated_document) NO se tocan: su código
  «GEN-…» sigue siendo único por empresa.

  Correr DESPUÉS de volver al código anterior al S19. Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @n INT = 0;
IF COL_LENGTH(N'sgc.document_type', N'generator_guide') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[document_type] WHERE [generator_guide] = 1', N'@n INT OUTPUT', @n = @n OUTPUT;
IF @n > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_generador_guia') AS INT) IS NULL
  THROW 51190, N'Hay tipos documentales marcados como plantilla guía del Generador: exporte la lista y declare sgc_reversa_generador_guia = 1.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261014130000_sgc_s19_generador_sin_codificacion';

IF OBJECT_ID(N'[sgc].[document_type_generator_guide_df]', N'D') IS NOT NULL
  ALTER TABLE [sgc].[document_type] DROP CONSTRAINT [document_type_generator_guide_df];
IF COL_LENGTH(N'sgc.document_type', N'generator_guide') IS NOT NULL
  ALTER TABLE [sgc].[document_type] DROP COLUMN [generator_guide];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261014130000_sgc_s19_generador_sin_codificacion';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
