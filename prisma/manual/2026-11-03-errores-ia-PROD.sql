/*
  PASE MANUAL (PRODUCCIÓN) — Auditoría de agentes → Errores de IA (2026-11-03).
  Pedido de Nicolás: «como un Sentry pero con los agentes».

  QUÉ HACE (aditivo e idempotente; solo crea lo que falta, no toca tablas existentes):
    - dbo.agent_error_issue  UN error agrupado por huella (agente + tipo + ambiente + primera línea
                             normalizada): primera y última vez, ocurrencias, estado
                             (abierto | resuelto | silenciado), último mensaje/conversación afectada,
                             cuándo se notificó por última vez y quién pidió reintentar.
    - dbo.agent_error_event  cada ocurrencia, con una clave única (el recolector relee los logs en
                             cada ronda: la clave evita contar dos veces la misma línea).
  Lo publica el recolector de errores (Mac de horus, solo lectura de logs) por
  POST /api/chat/auditoria/errores con la llave del recolector del inventario.
  Sin modelo Prisma (lib/agent-audit/errors-db.ts usa withMssqlPool).
  REVERSA: prisma/manual/2026-11-03-errores-ia-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB'
  THROW 51601, N'Base no esperada: este script es solo para KRONOSDB.', 1;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[agent_error_issue]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_error_issue] (
    [id_issue]        INT IDENTITY(1,1) NOT NULL,
    [huella]          CHAR(64)       NOT NULL,   -- sha256 hex de agente|tipo|ambiente|primera línea normalizada
    [agent_code]      NVARCHAR(60)   NOT NULL,   -- código del agente (agent.code) o «flota» si no es de uno
    [id_agent]        INT            NULL,
    [host]            NVARCHAR(60)   NULL,       -- equipo donde se vio (Mac de Jorge, ...)
    [tipo]            NVARCHAR(40)   NOT NULL,   -- turno_fallido | sesion_vencida | limite_uso | conector_caido | ...
    [severidad]       NVARCHAR(10)   NOT NULL,   -- alta | media | baja
    [ambiente]        NVARCHAR(10)   NOT NULL,   -- prod | pruebas
    [titulo]          NVARCHAR(300)  NOT NULL,
    [detalle]         NVARCHAR(2000) NULL,       -- última muestra (sin secretos)
    [first_seen]      DATETIME2(0)   NOT NULL,
    [last_seen]       DATETIME2(0)   NOT NULL,
    [ocurrencias]     INT            NOT NULL CONSTRAINT [DF_agent_error_issue_ocurrencias] DEFAULT (0),
    [estado]          NVARCHAR(12)   NOT NULL CONSTRAINT [DF_agent_error_issue_estado] DEFAULT (N'abierto'),
    [estado_por]      NVARCHAR(200)  NULL,
    [estado_at]       DATETIME2(0)   NULL,
    [notified_at]     DATETIME2(0)   NULL,
    [id_conversation] INT            NULL,       -- último mensaje/conversación afectada (si el log lo trae)
    [id_message]      INT            NULL,
    [reintento_por]   NVARCHAR(200)  NULL,
    [reintento_at]    DATETIME2(0)   NULL,
    [created_at]      DATETIME2(0)   NOT NULL CONSTRAINT [DF_agent_error_issue_created] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_agent_error_issue] PRIMARY KEY ([id_issue]),
    CONSTRAINT [UQ_agent_error_issue_huella] UNIQUE ([huella]),
    CONSTRAINT [CK_agent_error_issue_estado] CHECK ([estado] IN (N'abierto', N'resuelto', N'silenciado')),
    CONSTRAINT [CK_agent_error_issue_severidad] CHECK ([severidad] IN (N'alta', N'media', N'baja')),
    CONSTRAINT [CK_agent_error_issue_ambiente] CHECK ([ambiente] IN (N'prod', N'pruebas')),
    CONSTRAINT [FK_agent_error_issue_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE SET NULL
  );
  CREATE INDEX [IX_agent_error_issue_estado] ON [dbo].[agent_error_issue]([estado], [last_seen] DESC);
  CREATE INDEX [IX_agent_error_issue_agent] ON [dbo].[agent_error_issue]([agent_code], [tipo]);
END;
IF OBJECT_ID(N'[dbo].[agent_error_event]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_error_event] (
    [id_event]        BIGINT IDENTITY(1,1) NOT NULL,
    [id_issue]        INT            NOT NULL,
    [evento_clave]    CHAR(64)       NOT NULL,   -- sha256 hex de huella|clave del recolector
    [ocurrio_at]      DATETIME2(0)   NOT NULL,
    [id_conversation] INT            NULL,
    [id_message]      INT            NULL,
    [muestra]         NVARCHAR(1000) NULL,
    [recibido_at]     DATETIME2(0)   NOT NULL CONSTRAINT [DF_agent_error_event_recibido] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_agent_error_event] PRIMARY KEY ([id_event]),
    CONSTRAINT [UQ_agent_error_event_clave] UNIQUE ([evento_clave]),
    CONSTRAINT [FK_agent_error_event_issue] FOREIGN KEY ([id_issue]) REFERENCES [dbo].[agent_error_issue]([id_issue]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_agent_error_event_issue] ON [dbo].[agent_error_event]([id_issue], [ocurrio_at] DESC);
END;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_error_issue', N'U') AS agent_error_issue, OBJECT_ID(N'dbo.agent_error_event', N'U') AS agent_error_event;
