/*
  REVERSA de la migración 20261008130000_sgc_s11_copias_no_controladas (SGC,
  Sprint 11) y de su dato (tipo de autorización SGC-COPIA-NC, que se
  DESACTIVA, no se borra). Se corre ANTES que la del Sprint 10.

  Quita las tablas uncontrolled_copy_request y uncontrolled_copy_event (con
  sus triggers) y las columnas nuevas de company_config (con sus CHECK y
  DEFAULT), y borra el registro de la migración en _prisma_migrations.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior. ⚠️ Se
  pierde el HISTORIAL de copias no controladas (quién, cuándo, por qué, quién
  autorizó y cada impresión): exportarlo antes. Si hay alguna solicitud la
  reversa se niega, salvo sgc_reversa_copias = 1 en la sesión.

  Es un cambio controlado: declara la sesión (trigger del Sprint 6). Idempotente.
*/

DECLARE @copias INT = 0;
IF OBJECT_ID(N'[sgc].[uncontrolled_copy_request]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[uncontrolled_copy_request]', N'@n INT OUTPUT', @n = @copias OUTPUT;
IF @copias > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_copias') AS INT) IS NULL
  THROW 51092, N'Hay solicitudes de copias no controladas: exporte su historial y declare sgc_reversa_copias = 1 antes de la reversa.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261008130000_sgc_s11_copias_no_controladas';

UPDATE [sgc].[authorization_type] SET [is_active] = 0, [updated_by] = N'reversa-s11', [updated_at] = SYSUTCDATETIME() WHERE [code] = N'SGC-COPIA-NC' AND [is_active] = 1;

IF OBJECT_ID(N'[sgc].[uncontrolled_copy_event_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[uncontrolled_copy_event_solo_insercion];
IF OBJECT_ID(N'[sgc].[uncontrolled_copy_event]', N'U') IS NOT NULL DROP TABLE [sgc].[uncontrolled_copy_event];
IF OBJECT_ID(N'[sgc].[uncontrolled_copy_request_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[uncontrolled_copy_request_sin_borrado];
IF OBJECT_ID(N'[sgc].[uncontrolled_copy_request]', N'U') IS NOT NULL DROP TABLE [sgc].[uncontrolled_copy_request];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'company_config_copias_ck')
  ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [company_config_copias_ck];
DECLARE @col SYSNAME;
DECLARE @df SYSNAME;
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (N'uncontrolled_copy_types'), (N'uncontrolled_copy_days'), (N'uncontrolled_copy_max_days'), (N'viewer_protection')) AS x(name);
OPEN cols;
FETCH NEXT FROM cols INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @df = (SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'[sgc].[company_config]') AND c.name = @col);
  IF @df IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP CONSTRAINT [' + @df + N']');
  IF COL_LENGTH(N'sgc.company_config', @col) IS NOT NULL EXEC (N'ALTER TABLE [sgc].[company_config] DROP COLUMN [' + @col + N']');
  FETCH NEXT FROM cols INTO @col;
END;
CLOSE cols;
DEALLOCATE cols;

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008130000_sgc_s11_copias_no_controladas';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
