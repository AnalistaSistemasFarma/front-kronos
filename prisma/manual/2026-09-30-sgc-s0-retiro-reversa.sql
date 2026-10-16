/*
  REVERSA del retiro del módulo de Gestión Documental (SGC documental, S0).
  Deshace, en este orden:
    (a) la migración 20260930100000_sgc_s0_retiro_gestion_documental
        (recrea las 5 tablas document_* con su forma final, la de las 4
        migraciones originales 20260821000000, 20260821120000, 20260902130000
        y 20260902150000), y
    (b) prisma/manual/2026-09-30-sgc-s0-retiro-datos.sql (reinserta cada fila
        desde las tablas dbo.bk_20260930_*, conservando sus ids).
  Solo con autorización. Idempotente: no duplica filas que ya existan.
  Compatible con SQL Server 2016 (sin STRING_AGG).
  Al terminar, vuelva a desplegar el código anterior al PR del Sprint 0 si
  también se quiere recuperar el módulo en pantalla.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.bk_20260930_process_category', N'U') IS NULL
  THROW 50002, N'No existe el respaldo dbo.bk_20260930_*: no hay nada que restaurar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* (a) Tablas del módulo (forma final de las 4 migraciones originales) */
  IF OBJECT_ID(N'dbo.document_type', N'U') IS NULL
    CREATE TABLE [dbo].[document_type] (
      [id_document_type] INT NOT NULL IDENTITY(1,1),
      [name] NVARCHAR(150) NOT NULL,
      [code_prefix] NVARCHAR(20) NOT NULL,
      [ggc_process] NVARCHAR(150),
      [is_active] BIT NOT NULL CONSTRAINT [document_type_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [document_type_pkey] PRIMARY KEY CLUSTERED ([id_document_type]),
      CONSTRAINT [document_type_code_prefix_key] UNIQUE NONCLUSTERED ([code_prefix])
    );

  IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NULL
    CREATE TABLE [dbo].[document_process_category] (
      [id] INT NOT NULL IDENTITY(1,1),
      [name] NVARCHAR(200) NOT NULL,
      [display_order] INT NOT NULL CONSTRAINT [document_process_category_display_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [document_process_category_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_process_category_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [document_process_category_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [document_process_category_name_key] UNIQUE NONCLUSTERED ([name])
    );

  IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[document_process_subprocess] (
      [id] INT NOT NULL IDENTITY(1,1),
      [id_document_process_category] INT NOT NULL,
      [name] NVARCHAR(200) NOT NULL,
      [display_order] INT NOT NULL CONSTRAINT [document_process_subprocess_display_order_df] DEFAULT 0,
      [is_active] BIT NOT NULL CONSTRAINT [document_process_subprocess_is_active_df] DEFAULT 1,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_process_subprocess_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [document_process_subprocess_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [document_process_subprocess_id_document_process_category_name_key] UNIQUE NONCLUSTERED ([id_document_process_category],[name])
    );
    ALTER TABLE [dbo].[document_process_subprocess] ADD CONSTRAINT [document_process_subprocess_id_document_process_category_fkey]
      FOREIGN KEY ([id_document_process_category]) REFERENCES [dbo].[document_process_category]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
  END

  IF OBJECT_ID(N'dbo.document', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[document] (
      [id_document] INT NOT NULL IDENTITY(1,1),
      [code] NVARCHAR(50) NOT NULL,
      [title] NVARCHAR(300) NOT NULL,
      [id_document_type] INT NOT NULL,
      [id_company] INT NOT NULL,
      [id_process] INT,
      [owner_user_id] NVARCHAR(1000) NOT NULL,
      [due_review_date] DATETIME2,
      [is_restricted] BIT NOT NULL CONSTRAINT [document_is_restricted_df] DEFAULT 0,
      [current_status] NVARCHAR(30) NOT NULL CONSTRAINT [document_current_status_df] DEFAULT 'Vigente',
      [current_version_id] INT,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [updated_at] DATETIME2 NOT NULL,
      [id_document_process_subprocess] INT,
      CONSTRAINT [document_pkey] PRIMARY KEY CLUSTERED ([id_document]),
      CONSTRAINT [document_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
    );
    CREATE NONCLUSTERED INDEX [document_id_company_current_status_idx] ON [dbo].[document]([id_company], [current_status]);
    CREATE NONCLUSTERED INDEX [document_id_document_type_idx] ON [dbo].[document]([id_document_type]);
    CREATE NONCLUSTERED INDEX [document_id_document_process_subprocess_idx] ON [dbo].[document]([id_document_process_subprocess]);
    ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [dbo].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_owner_user_id_fkey] FOREIGN KEY ([owner_user_id]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_document_process_subprocess_fkey] FOREIGN KEY ([id_document_process_subprocess]) REFERENCES [dbo].[document_process_subprocess]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.document_version', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[document_version] (
      [id_document_version] INT NOT NULL IDENTITY(1,1),
      [id_document] INT NOT NULL,
      [version_number] INT NOT NULL,
      [status] NVARCHAR(30) NOT NULL CONSTRAINT [document_version_status_df] DEFAULT 'Vigente',
      [onedrive_item_id] NVARCHAR(300),
      [onedrive_path] NVARCHAR(1000) NOT NULL,
      [created_by] NVARCHAR(1000) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [document_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      [comments] NVARCHAR(1000),
      [id_request_general] INT,
      [content_html] NVARCHAR(max),
      CONSTRAINT [document_version_pkey] PRIMARY KEY CLUSTERED ([id_document_version]),
      CONSTRAINT [document_version_id_document_version_number_key] UNIQUE NONCLUSTERED ([id_document],[version_number])
    );
    ALTER TABLE [dbo].[document_version] ADD CONSTRAINT [document_version_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [dbo].[document]([id_document]) ON DELETE CASCADE ON UPDATE CASCADE;
  END

  /* (b) Datos, de padres a hijos, conservando ids */
  DECLARE @pairs TABLE (ord INT PRIMARY KEY, tabla SYSNAME);
  INSERT INTO @pairs VALUES
    (1, N'document_type'), (2, N'document_process_category'), (3, N'document_process_subprocess'),
    (4, N'document'), (5, N'process_category'), (6, N'task_process_category'),
    (7, N'process_form_field'), (8, N'process_form_field_option'), (9, N'requests_general'),
    (10, N'document_version'), (11, N'process_category_request_general'), (12, N'task_request_general'),
    (13, N'request_form_value'), (14, N'notes'), (15, N'user_process_category_request_general'),
    (16, N'subprocess'), (17, N'subprocess_user_company'), (18, N'notifications');

  DECLARE @ord INT = 0, @tabla SYSNAME, @bk SYSNAME, @cols NVARCHAR(MAX), @pk SYSNAME, @ident BIT, @sql NVARCHAR(MAX);
  WHILE 1 = 1
  BEGIN
    SELECT TOP 1 @ord = ord, @tabla = tabla FROM @pairs WHERE ord > @ord ORDER BY ord;
    IF @@ROWCOUNT = 0 BREAK;
    SET @bk = N'bk_20260930_' + @tabla;
    IF OBJECT_ID(N'dbo.' + @bk, N'U') IS NULL CONTINUE;

    SET @cols = STUFF((
      SELECT N',' + QUOTENAME(c.name)
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.' + @bk)
        AND EXISTS (SELECT 1 FROM sys.columns t WHERE t.object_id = OBJECT_ID(N'dbo.' + @tabla) AND t.name = c.name AND t.is_computed = 0)
      ORDER BY c.column_id
      FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'');

    SELECT TOP 1 @pk = c.name
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.' + @tabla) AND i.is_primary_key = 1;

    SET @ident = CASE WHEN EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID(N'dbo.' + @tabla)) THEN 1 ELSE 0 END;

    SET @sql =
      CASE WHEN @ident = 1 THEN N'SET IDENTITY_INSERT dbo.' + QUOTENAME(@tabla) + N' ON; ' ELSE N'' END +
      N'INSERT INTO dbo.' + QUOTENAME(@tabla) + N' (' + @cols + N') SELECT ' + @cols +
      N' FROM dbo.' + QUOTENAME(@bk) + N' b WHERE NOT EXISTS (SELECT 1 FROM dbo.' + QUOTENAME(@tabla) +
      N' t WHERE t.' + QUOTENAME(@pk) + N' = b.' + QUOTENAME(@pk) + N'); ' +
      N'SELECT ''' + @tabla + N''' AS tabla, @@ROWCOUNT AS filas_restauradas; ' +
      CASE WHEN @ident = 1 THEN N'SET IDENTITY_INSERT dbo.' + QUOTENAME(@tabla) + N' OFF;' ELSE N'' END;
    EXEC sp_executesql @sql;
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930100000_sgc_s0_retiro_gestion_documental';
