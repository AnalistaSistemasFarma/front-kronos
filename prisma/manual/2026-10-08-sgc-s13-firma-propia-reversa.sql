/*
  REVERSA de la migración 20261008150000_sgc_s13_firma_propia_registro (SGC,
  Sprint 13). Se corre ANTES que la del Sprint 12.

  Quita el trigger signature_master_validacion_una_vez, el CHECK y las
  columnas origin, capture_method, validation_status, validated_by y
  validated_at de signature_master y self_signature_enabled de company_config,
  y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Las firmas PROPIAS (registradas por su titular) se REVOCAN antes de
  quitar las columnas: sin la columna de validación, una firma pendiente
  quedaría como si estuviera validada. Si hay firmas propias, la reversa se
  niega salvo sgc_reversa_firma_propia = 1 en la sesión. Las firmas ya
  estampadas en documentos no cambian (su huella está en sgc.signature).

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @propias INT = 0;
IF COL_LENGTH(N'sgc.signature_master', N'origin') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[signature_master] WHERE [origin] = N''propia''', N'@n INT OUTPUT', @n = @propias OUTPUT;
IF @propias > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_firma_propia') AS INT) IS NULL
  THROW 51111, N'Hay firmas propias registradas por su titular: exporte el maestro y declare sgc_reversa_firma_propia = 1 antes de la reversa (se revocarán).', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008150000_sgc_s13_firma_propia_registro';

IF OBJECT_ID(N'[sgc].[signature_master_validacion_una_vez]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signature_master_validacion_una_vez];
IF COL_LENGTH(N'sgc.signature_master', N'origin') IS NOT NULL
  EXEC sp_executesql N'UPDATE [sgc].[signature_master] SET revoked_at = SYSUTCDATETIME(), revoked_by = N''reversa-s13'', revoke_reason = N''Reversa del Sprint 13: se retira la firma propia.'' WHERE [origin] = N''propia'' AND revoked_at IS NULL';
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signature_master_firma_propia_ck')
  ALTER TABLE [sgc].[signature_master] DROP CONSTRAINT [signature_master_firma_propia_ck];

DECLARE @tbl SYSNAME;
DECLARE @col SYSNAME;
DECLARE @df SYSNAME;
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR SELECT t, c FROM (VALUES (N'signature_master', N'origin'), (N'signature_master', N'capture_method'), (N'signature_master', N'validation_status'), (N'signature_master', N'validated_by'), (N'signature_master', N'validated_at'), (N'company_config', N'self_signature_enabled')) AS x(t, c);
OPEN cols;
FETCH NEXT FROM cols INTO @tbl, @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[' + @tbl + N']') AND c.name = @col);
  IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[' + @tbl + N'] DROP CONSTRAINT [' + @df + N']');
  IF COL_LENGTH(N'sgc.' + @tbl, @col) IS NOT NULL EXEC (N'ALTER TABLE [sgc].[' + @tbl + N'] DROP COLUMN [' + @col + N']');
  FETCH NEXT FROM cols INTO @tbl, @col;
END;
CLOSE cols;
DEALLOCATE cols;

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008150000_sgc_s13_firma_propia_registro';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
