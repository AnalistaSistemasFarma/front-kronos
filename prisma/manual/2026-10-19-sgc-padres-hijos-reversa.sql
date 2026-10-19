/*
  REVERSA de 20261019100000_sgc_padres_hijos (documentos padre e hijos, 2026-10-19).
  Quita [sgc].[document_type].[is_parent_type] (y su DEFAULT) y deja la
  restricción del origen de las relaciones como estaba (manual, codigo, listado).

  ⚠️ SE NIEGA (THROW) sin sgc_reversa_padres_hijos = 1 si:
    - algún tipo documental está marcado como «padre», o
    - hay relaciones con origen «solicitud» o «carga» (las que el código nuevo
      creó solas). Con la bandera, esas relaciones NO se borran ni se retiran:
      su origen pasa a «manual» para que el CHECK anterior las acepte. El
      origen real queda en sgc.audit_log (acción relacion.automatica).
  Antes de declarar la bandera, exporte:
    SELECT id_document_type, code, name FROM sgc.document_type WHERE is_parent_type = 1;
    SELECT id_document_relation, origin FROM sgc.document_relation WHERE origin IN (N'solicitud', N'carga');

  Correr DESPUÉS de volver al código anterior. Idempotente. Sirve igual en
  KRONOSDB_PRUEBAS y en KRONOSDB.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @tipos INT = 0;
DECLARE @automaticas INT = 0;
IF COL_LENGTH(N'sgc.document_type', N'is_parent_type') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[document_type] WHERE [is_parent_type] = 1', N'@n INT OUTPUT', @n = @tipos OUTPUT;
SELECT @automaticas = COUNT(*) FROM [sgc].[document_relation] WHERE [origin] IN (N'solicitud', N'carga');
IF (@tipos > 0 OR @automaticas > 0) AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_padres_hijos') AS INT) IS NULL
  THROW 51200, N'Hay tipos documentales marcados como padre o relaciones creadas solas (origen solicitud o carga): exporte la lista y declare sgc_reversa_padres_hijos = 1.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261019100000_sgc_padres_hijos';

BEGIN TRY
  BEGIN TRANSACTION;
  IF @automaticas > 0
    UPDATE [sgc].[document_relation] SET [origin] = N'manual' WHERE [origin] IN (N'solicitud', N'carga');

  IF OBJECT_ID(N'[sgc].[document_type_is_parent_type_df]', N'D') IS NOT NULL
    ALTER TABLE [sgc].[document_type] DROP CONSTRAINT [document_type_is_parent_type_df];
  IF COL_LENGTH(N'sgc.document_type', N'is_parent_type') IS NOT NULL
    ALTER TABLE [sgc].[document_type] DROP COLUMN [is_parent_type];

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck' AND definition LIKE N'%solicitud%')
    ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [document_relation_origen_estado_ck];
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
    EXEC sp_executesql N'ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_origen_estado_ck] CHECK ([origin] IN (N''manual'', N''codigo'', N''listado'') AND [status] IN (N''propuesta'', N''confirmada''));';

  IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
    DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261019100000_sgc_padres_hijos';
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
  EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
  THROW;
END CATCH;

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
