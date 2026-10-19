/*
  PASE MANUAL (PRUEBAS) — Proyectos (hilos de agente) del chat, F1 piloto.
  Aprobado por Nicolás Rivera el 2026-10-17. BASE: KRONOSDB_PRUEBAS (el
  script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea e inserta, no borra ni modifica datos):
    1. El DDL de prisma/migrations/20261017120000_chat_projects.
    2. Tres proyectos de ejemplo para el agente del piloto (@AgentCode, por
       defecto 'play' = Play, @silvia_gss_bot): Farmalógica, One Latam Pharma
       y Comex Latam. Dueño: @OwnerEmail. Miembros opcionales: @MiembrosCsv.

  REGLAS DE LA SIEMBRA (las mismas que aplica el código):
    - La EMPRESA del proyecto debe ser una a la que pertenece el agente
      (agent_company) Y en la que el dueño tiene el permiso del agente. Se
      prefiere la empresa que coincide con el patrón del ejemplo; si el agente
      no está en esa empresa, se usa la primera que cumpla las dos
      condiciones. Si no hay ninguna, el ejemplo se SALTA con un mensaje.
    - El PERFIL de conectores es independiente de la empresa del permiso: es
      lo que decide qué conectores MCP monta el puente (puente-hilos/).
    - Un miembro solo se agrega si tiene el permiso del agente en la empresa
      del proyecto; si no, se avisa y se sigue.

  ⚠️ ORDEN: 1) respaldo COPY_ONLY, 2) este script, 3) el código (si el código
  sale antes, TODO el chat falla con "Invalid column name").
  🔒 LOCK_TIMEOUT 5000: si falla con 1222, nada quedó a medias; reintente.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-
  front-kronos») o SSMS. REVERSA: prisma/manual/2026-10-17-chat-proyectos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51471, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

/* ===================== PARÁMETROS ===================== */
DECLARE @AgentCode   NVARCHAR(60)  = N'play';
DECLARE @OwnerEmail  NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
-- Correos separados por coma, p. ej. N'silvia.quintana@...,angye.mancipe@...'
DECLARE @MiembrosCsv NVARCHAR(MAX) = N'';
/* ====================================================== */

SELECT DB_NAME() AS base, 'antes' AS momento,
       OBJECT_ID(N'dbo.chat_project', N'U') AS chat_project_id,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck') AS kind_ck;

BEGIN TRY
BEGIN TRANSACTION;

/* ---- 1. chat_project ------------------------------------------------ */
IF OBJECT_ID(N'[dbo].[chat_project]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project] (
    [id_project]   INT            IDENTITY(1,1) NOT NULL,
    [name]         NVARCHAR(120)  NOT NULL,
    [id_agent]     INT            NOT NULL,
    [id_company]   INT            NOT NULL,
    [profile]      NVARCHAR(40)   NOT NULL,
    [instructions] NVARCHAR(MAX)  NULL,
    [created_by]   NVARCHAR(1000) NOT NULL,
    [archived]     BIT            NOT NULL CONSTRAINT [chat_project_archived_df] DEFAULT 0,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [chat_project_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]   DATETIME2      NOT NULL CONSTRAINT [chat_project_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_pkey] PRIMARY KEY CLUSTERED ([id_project]),
    CONSTRAINT [chat_project_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project]([id_agent], [archived]);
  CREATE NONCLUSTERED INDEX [chat_project_id_company_idx] ON [dbo].[chat_project]([id_company]);
END;

/* ---- 2. chat_project_member ----------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_member]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_member] (
    [id_project_member] INT            IDENTITY(1,1) NOT NULL,
    [id_project]        INT            NOT NULL,
    [id_user]           NVARCHAR(1000) NOT NULL,
    [role]              NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_member_role_df] DEFAULT N'member',
    [added_by]          NVARCHAR(1000) NULL,
    [added_at]          DATETIME2      NOT NULL CONSTRAINT [chat_project_member_added_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_member_pkey] PRIMARY KEY CLUSTERED ([id_project_member]),
    CONSTRAINT [chat_project_member_project_user] UNIQUE NONCLUSTERED ([id_project], [id_user]),
    CONSTRAINT [chat_project_member_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_member_id_user_fkey] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_member_id_user_idx] ON [dbo].[chat_project_member]([id_user]);
END;

/* ---- 2b. Reglas de integridad (bloques propios: también se aplican si
   las tablas las creó `prisma db push`, que no conoce CHECK ni índices
   filtrados) ---------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_name_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_name_ck]
    CHECK (LEN(LTRIM(RTRIM([name]))) > 0);');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_profile_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_profile_ck]
    CHECK (LEN([profile]) > 0 AND [profile] COLLATE Latin1_General_BIN NOT LIKE N''%[^a-z0-9-]%'');');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_member_role_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_member] WITH CHECK ADD CONSTRAINT [chat_project_member_role_ck]
    CHECK ([role] IN (N''owner'', N''member''));');

-- UN solo dueño por proyecto, garantizado por la base y no por cada endpoint.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_project_member_owner' AND object_id = OBJECT_ID(N'[dbo].[chat_project_member]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [UX_chat_project_member_owner]
    ON [dbo].[chat_project_member]([id_project]) WHERE [role] = N''owner'';');

/* ---- 3. chat_project_file ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_file]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_file] (
    [id_project_file]  INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [file_name]        NVARCHAR(400)  NOT NULL,
    [content_type]     NVARCHAR(200)  NULL,
    [size_bytes]       INT            NULL,
    [onedrive_item_id] NVARCHAR(300)  NULL,
    [uploaded_by]      NVARCHAR(1000) NULL,
    [created_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_file_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_file_pkey] PRIMARY KEY CLUSTERED ([id_project_file]),
    CONSTRAINT [chat_project_file_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE NONCLUSTERED INDEX [chat_project_file_id_project_idx] ON [dbo].[chat_project_file]([id_project]);
END;

/* ---- 4. chat_conversation: id_project + CHECKs ---------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'id_project')
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [id_project] INT NULL;
END;

-- En lotes propios (EXEC): nombran una columna creada en ESTE lote.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_conversation_id_project_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_id_project_fkey]
    FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_conversation_id_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_conversation_id_project_idx] ON [dbo].[chat_conversation]([id_project]);');
END;

-- La clase 'project' entra al CHECK de kind (se reemplaza solo si aún no la admite).
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck' AND definition NOT LIKE '%project%')
BEGIN
  ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_kind_ck];
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_kind_ck]
    CHECK ([kind] IN (''direct'', ''group'', ''people'', ''project''));');
END;

-- Una conversación de proyecto SIEMPRE tiene proyecto, y ninguna otra lo tiene.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_project_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_project_ck]
    CHECK (([kind] = ''project'' AND [id_project] IS NOT NULL) OR ([kind] <> ''project'' AND [id_project] IS NULL));');
END;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* ==================================================================== */
/* SIEMBRA — hilos de ejemplo del piloto (lote aparte: usa las tablas    */
/* nuevas, que el compilador no conoce hasta que existen).               */
/* ==================================================================== */
EXEC sp_executesql N'
SET XACT_ABORT ON;

DECLARE @AgentId INT, @AgentSub INT, @OwnerId NVARCHAR(1000);
SELECT @AgentId = id_agent, @AgentSub = id_subprocess FROM [dbo].[agent] WHERE code = @AgentCode AND is_active = 1;
IF @AgentId IS NULL OR @AgentSub IS NULL
BEGIN
  PRINT N''El agente '' + @AgentCode + N'' no existe, está inactivo o no tiene subproceso-permiso. No se siembran proyectos.'';
  RETURN;
END;

SELECT @OwnerId = id FROM [dbo].[user] WHERE email = @OwnerEmail AND isActive = 1;
IF @OwnerId IS NULL
BEGIN
  PRINT N''El dueño '' + @OwnerEmail + N'' no existe o está inactivo. No se siembran proyectos.'';
  RETURN;
END;

-- Correos de @MiembrosCsv, sin STRING_SPLIT (la base es SQL Server 2016 y
-- STRING_SPLIT depende del nivel de compatibilidad).
DECLARE @Miembros TABLE (email NVARCHAR(255) PRIMARY KEY);
DECLARE @resto NVARCHAR(MAX) = ISNULL(@MiembrosCsv, N'''') + N'','', @pos INT, @uno NVARCHAR(255);
WHILE LEN(@resto) > 0
BEGIN
  SET @pos = CHARINDEX(N'','', @resto);
  SET @uno = LTRIM(RTRIM(LEFT(@resto, @pos - 1)));
  SET @resto = SUBSTRING(@resto, @pos + 1, LEN(@resto));
  IF @uno <> N'''' AND NOT EXISTS (SELECT 1 FROM @Miembros WHERE email = @uno) INSERT INTO @Miembros (email) VALUES (@uno);
END;

DECLARE @Ejemplos TABLE (n INT IDENTITY(1,1), nombre NVARCHAR(120), perfil NVARCHAR(40), patron NVARCHAR(100), instrucciones NVARCHAR(MAX));
INSERT INTO @Ejemplos (nombre, perfil, patron, instrucciones) VALUES
 (N''Farmalógica — Operaciones'', N''farmalogica'', N''%FARMAL%GICA%'',
  N''Este proyecto trata SOLO de las operaciones de Farmalógica S.A.: compras, inventario y abastecimiento. Si le preguntan por otra empresa, indíquelo y pida que lo consulten en el proyecto que corresponda. Responda en español colombiano formal y cite la fuente de cada cifra.''),
 (N''One Latam Pharma — Abastecimiento'', N''olp'', N''%LATAM%PHARMA%'',
  N''Este proyecto trata SOLO de One Latam Pharma (OLP): abastecimiento, órdenes de compra y seguimiento a proveedores. No mezcle datos de otras empresas. Responda en español colombiano formal y cite la fuente de cada cifra.''),
 (N''Comex Latam'', N''comex-latam'', N''%LATAM%PHARMA%'',
  N''Este proyecto es de Comercio Exterior para Latinoamérica: importaciones, puertos, navieras, tiempos de tránsito y documentos de comercio exterior. Cuando use información de internet, diga la fecha y la fuente. Responda en español colombiano formal.'');

DECLARE @i INT = 1, @max INT = (SELECT MAX(n) FROM @Ejemplos);
WHILE @i <= @max
BEGIN
  DECLARE @Nombre NVARCHAR(120), @Perfil NVARCHAR(40), @Patron NVARCHAR(100), @Instr NVARCHAR(MAX), @Company INT, @ProjectId INT;
  -- DECLARE dentro del WHILE no reinicia en cada vuelta: se limpia a mano.
  SET @Company = NULL; SET @ProjectId = NULL;
  SELECT @Nombre = nombre, @Perfil = perfil, @Patron = patron, @Instr = instrucciones FROM @Ejemplos WHERE n = @i;

  IF EXISTS (SELECT 1 FROM [dbo].[chat_project] WHERE id_agent = @AgentId AND name = @Nombre)
  BEGIN
    PRINT N''Ya existe el proyecto '' + @Nombre + N''; se deja como está.'';
    SET @i += 1;
    CONTINUE;
  END;

  -- Empresas válidas: el agente pertenece Y el dueño tiene el permiso del agente.
  SELECT TOP 1 @Company = ac.id_company
  FROM [dbo].[agent_company] ac
  JOIN [dbo].[company] c ON c.id_company = ac.id_company
  WHERE ac.id_agent = @AgentId
    AND EXISTS (
      SELECT 1 FROM [dbo].[subprocess_user_company] suc
      JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
      WHERE suc.id_subprocess = @AgentSub AND cu.id_company = ac.id_company AND cu.id_user = @OwnerId)
  ORDER BY CASE WHEN UPPER(c.company) LIKE @Patron THEN 0 ELSE 1 END, ac.is_primary DESC, ac.id_company;

  IF @Company IS NULL
  BEGIN
    PRINT N''Sin empresa válida para '' + @Nombre + N'': el dueño no tiene el permiso del agente en ninguna de sus empresas. Se salta.'';
    SET @i += 1;
    CONTINUE;
  END;

  BEGIN TRANSACTION;
    INSERT INTO [dbo].[chat_project] (name, id_agent, id_company, profile, instructions, created_by)
    VALUES (@Nombre, @AgentId, @Company, @Perfil, @Instr, @OwnerId);
    SET @ProjectId = SCOPE_IDENTITY();

    INSERT INTO [dbo].[chat_project_member] (id_project, id_user, role, added_by)
    VALUES (@ProjectId, @OwnerId, N''owner'', @OwnerId);

    INSERT INTO [dbo].[chat_project_member] (id_project, id_user, role, added_by)
    SELECT DISTINCT @ProjectId, u.id, N''member'', @OwnerId
    FROM @Miembros s
    JOIN [dbo].[user] u ON u.email = s.email AND u.isActive = 1
    WHERE u.id <> @OwnerId
      AND EXISTS (
        SELECT 1 FROM [dbo].[subprocess_user_company] suc
        JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
        WHERE suc.id_subprocess = @AgentSub AND cu.id_company = @Company AND cu.id_user = u.id);

    -- Primera conversación del proyecto, para que el hilo se pueda abrir de una vez.
    INSERT INTO [dbo].[chat_conversation] (id_user, id_agent, title, kind, id_company, created_by, id_project, updated_at)
    VALUES (@OwnerId, @AgentId, N''Conversación inicial'', N''project'', @Company, @OwnerId, @ProjectId, CURRENT_TIMESTAMP);
  COMMIT TRANSACTION;

  PRINT N''Proyecto creado: '' + @Nombre + N'' (id '' + CAST(@ProjectId AS NVARCHAR(20)) + N'').'';
  SET @i += 1;
END;

-- Miembros que NO se pudieron agregar (sin permiso del agente o sin usuario).
SELECT s.email AS correo_no_agregado
FROM @Miembros s
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[chat_project_member] m
    JOIN [dbo].[user] u ON u.id = m.id_user
    JOIN [dbo].[chat_project] p ON p.id_project = m.id_project
    WHERE p.id_agent = @AgentId AND u.email = s.email);
',
N'@AgentCode NVARCHAR(60), @OwnerEmail NVARCHAR(255), @MiembrosCsv NVARCHAR(MAX)',
@AgentCode = @AgentCode, @OwnerEmail = @OwnerEmail, @MiembrosCsv = @MiembrosCsv;

/* Estado DESPUÉS */
SELECT DB_NAME() AS base, 'despues' AS momento,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck') AS kind_ck,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_project_ck') AS project_ck;

EXEC sp_executesql N'
SELECT p.id_project, p.name, a.code AS agente, c.company AS empresa, p.profile AS perfil,
       (SELECT COUNT(*) FROM [dbo].[chat_project_member] m WHERE m.id_project = p.id_project) AS miembros,
       (SELECT COUNT(*) FROM [dbo].[chat_conversation] cv WHERE cv.id_project = p.id_project) AS conversaciones
FROM [dbo].[chat_project] p
JOIN [dbo].[agent] a ON a.id_agent = p.id_agent
JOIN [dbo].[company] c ON c.id_company = p.id_company
ORDER BY p.id_project;';
