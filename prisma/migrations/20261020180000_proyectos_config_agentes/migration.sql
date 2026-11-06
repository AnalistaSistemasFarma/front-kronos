/*
  Migración: proyectos_config_agentes — CONFIGURACIÓN de «Proyectos» por empresa desde la interfaz.
  Pedido de Nicolás Rivera del 2026-10-20 (12:44 COT): los permisos y la configuración de Proyectos
  se manejan desde SynerLink y no por detrás (CHAT_PROJECTS_AGENTS del .env). Ver
  lib/proyectos/config-agentes-rules.ts y lib/proyectos/config-agentes.ts.

  ADITIVO e IDEMPOTENTE, se puede aplicar en caliente (el código anterior no lee nada de esto):
    - chat_project_agent_config      una fila por (empresa, agente): habilitado y perfiles de conectores.
    - chat_project_agent_config_log  registro inmutable de cada cambio (antes, después y motivo).
  No copia ni toca datos. Con la tabla VACÍA, cada empresa sigue con lo que diga CHAT_PROJECTS_AGENTS:
  el pase no cambia nada hasta que alguien configure una empresa desde la pantalla.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/config-agentes-sql.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_agent', N'U') IS NULL
  THROW 51510, N'Falta la migración 20261018120000_proyectos_modulo (chat_project_agent). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_agent_config]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_config] (
    [id_config]  INT            IDENTITY(1,1) NOT NULL,
    [id_company] INT            NOT NULL,
    [id_agent]   INT            NOT NULL,
    [enabled]    BIT            NOT NULL CONSTRAINT [chat_project_agent_config_enabled_df] DEFAULT 0,
    [profiles]   NVARCHAR(400)  NULL,
    [reason]     NVARCHAR(500)  NULL,
    [updated_by] NVARCHAR(1000) NULL,
    [created_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_config_pkey] PRIMARY KEY CLUSTERED ([id_config]),
    CONSTRAINT [chat_project_agent_config_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_agent_config_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_company_agent' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_agent_config_company_agent] ON [dbo].[chat_project_agent_config]([id_company], [id_agent]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_id_agent_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_config_id_agent_idx] ON [dbo].[chat_project_agent_config]([id_agent]);');
-- Habilitado exige al menos un perfil escrito o heredado del .env (NULL); vacío no vale.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_config_profiles_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_config] WITH CHECK ADD CONSTRAINT [chat_project_agent_config_profiles_ck] CHECK ([profiles] IS NULL OR LEN([profiles]) > 0);');

IF OBJECT_ID(N'[dbo].[chat_project_agent_config_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent_config_log] (
    [id_log]          INT            IDENTITY(1,1) NOT NULL,
    [id_company]      INT            NOT NULL,
    [id_agent]        INT            NOT NULL,
    [action]          NVARCHAR(20)   NOT NULL,
    [enabled_before]  BIT            NULL,
    [enabled_after]   BIT            NOT NULL,
    [profiles_before] NVARCHAR(400)  NULL,
    [profiles_after]  NVARCHAR(400)  NULL,
    [reason]          NVARCHAR(500)  NOT NULL,
    [changed_by]      NVARCHAR(1000) NULL,
    [changed_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_config_log_changed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_config_log_pkey] PRIMARY KEY CLUSTERED ([id_log])
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_agent_config_log_company_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_agent_config_log]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_agent_config_log_company_idx] ON [dbo].[chat_project_agent_config_log]([id_company], [changed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_agent_config_log_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_agent_config_log] WITH CHECK ADD CONSTRAINT [chat_project_agent_config_log_valores_ck]
    CHECK ([action] IN (N''cambio'', N''copia_env'') AND LEN([reason]) > 0);');

IF OBJECT_ID(N'[dbo].[TR_chat_project_agent_config_log_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_agent_config_log_inmutable] ON [dbo].[chat_project_agent_config_log]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51511, N''El registro de cambios de la configuración de Proyectos no se cambia ni se borra.'', 1;
    END;');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
