/*
  PASE MANUAL (PRUEBAS) — Memorias de los agentes: mapa general y mapa personal (2026-10-29).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ninguna tabla existente):
    - dbo.agent_memory          lo que cada agente aprendió (título, contenido con los secretos
                                ya ocultos, tipo, tema y fechas de origen). Una fila por
                                (agente, origen, clave de origen). La publica el recolector.
    - dbo.agent_memory_link     enlaces entre memorias (relaciones de engram y [[wikilinks]]).
    - dbo.agent_memory_setting  por agente: departamento (para el mapa general) y, si es un
                                agente PERSONAL, el correo del único dueño que lo ve (sale del
                                mapa general y solo aparece en el mapa personal de ese correo).
    - dbo.agent_memory_run      cada corrida del recolector (equipo, cifras, errores).
    - Semilla: Orus (horus), Mechita y Sawblaze como agentes personales de Nicolás Rivera
      (decisión provisional del 2026-10-29, se cambia con un UPDATE).

  Sin modelo Prisma (lib/agent-audit/memories-db.ts usa withMssqlPool): NO cambia schema.prisma
  ni exige prisma generate. Sin las tablas, la pantalla muestra «aún no habilitado».

  ORDEN: puede ir antes o después del código.
  REVERSA: prisma/manual/2026-10-29-memorias-agentes-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51571, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[agent_memory]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_memory] (
    [id_memory]          BIGINT IDENTITY(1,1) NOT NULL,
    [id_agent]           INT            NOT NULL,
    [source]             NVARCHAR(20)   NOT NULL,
    [source_key]         NVARCHAR(200)  NOT NULL,
    [title]              NVARCHAR(400)  NOT NULL,
    [content]            NVARCHAR(MAX)  NULL,
    [mem_type]           NVARCHAR(40)   NOT NULL,
    [topic]              NVARCHAR(200)  NULL,
    [source_created_at]  DATETIME2(0)   NULL,
    [source_updated_at]  DATETIME2(0)   NULL,
    [secrets_hidden]     INT            NOT NULL CONSTRAINT [DF_agent_memory_secrets] DEFAULT (0),
    [collected_at]       DATETIME2(0)   NOT NULL,
    [deleted_at]         DATETIME2(0)   NULL,
    CONSTRAINT [PK_agent_memory] PRIMARY KEY ([id_memory]),
    CONSTRAINT [FK_agent_memory_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX [UX_agent_memory_origen] ON [dbo].[agent_memory]([id_agent], [source], [source_key]);
  CREATE INDEX [IX_agent_memory_agente] ON [dbo].[agent_memory]([id_agent], [deleted_at]);
END;

IF OBJECT_ID(N'[dbo].[agent_memory_link]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_memory_link] (
    [id_link]       BIGINT IDENTITY(1,1) NOT NULL,
    [id_from]       BIGINT        NOT NULL,
    [id_to]         BIGINT        NOT NULL,
    [relation]      NVARCHAR(40)  NOT NULL,
    [collected_at]  DATETIME2(0)  NOT NULL,
    CONSTRAINT [PK_agent_memory_link] PRIMARY KEY ([id_link]),
    CONSTRAINT [FK_agent_memory_link_from] FOREIGN KEY ([id_from]) REFERENCES [dbo].[agent_memory]([id_memory]) ON DELETE CASCADE,
    CONSTRAINT [FK_agent_memory_link_to] FOREIGN KEY ([id_to]) REFERENCES [dbo].[agent_memory]([id_memory])
  );
  CREATE UNIQUE INDEX [UX_agent_memory_link] ON [dbo].[agent_memory_link]([id_from], [id_to], [relation]);
  CREATE INDEX [IX_agent_memory_link_to] ON [dbo].[agent_memory_link]([id_to]);
END;

IF OBJECT_ID(N'[dbo].[agent_memory_setting]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_memory_setting] (
    [id_agent]             INT            NOT NULL,
    [department]           NVARCHAR(120)  NULL,
    [private_owner_email]  NVARCHAR(200)  NULL,
    [updated_by]           NVARCHAR(200)  NULL,
    [updated_at]           DATETIME2(0)   NOT NULL,
    CONSTRAINT [PK_agent_memory_setting] PRIMARY KEY ([id_agent]),
    CONSTRAINT [FK_agent_memory_setting_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
END;

IF OBJECT_ID(N'[dbo].[agent_memory_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_memory_run] (
    [id_run]          INT IDENTITY(1,1) NOT NULL,
    [host]            NVARCHAR(120)  NOT NULL,
    [agents]          INT            NOT NULL,
    [memories]        INT            NOT NULL,
    [links]           INT            NOT NULL,
    [secrets_hidden]  INT            NOT NULL,
    [errors]          NVARCHAR(2000) NULL,
    [collector_version] NVARCHAR(20) NULL,
    [finished_at]     DATETIME2(0)   NOT NULL,
    CONSTRAINT [PK_agent_memory_run] PRIMARY KEY ([id_run])
  );
END;

/* Semilla provisional: agentes personales de Nicolás (solo si aún no tienen ajuste). */
INSERT INTO [dbo].[agent_memory_setting] (id_agent, department, private_owner_email, updated_by, updated_at)
SELECT a.id_agent, N'Tecnología', N'nicolas.rivera@gsslatam.com', N'pase 2026-10-29', SYSUTCDATETIME()
FROM [dbo].[agent] a
WHERE a.code IN (N'horus', N'mechita', N'sawblaze')
  AND NOT EXISTS (SELECT 1 FROM [dbo].[agent_memory_setting] s WHERE s.id_agent = a.id_agent);

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.agent_memory', N'U') AS agent_memory,
       OBJECT_ID(N'dbo.agent_memory_link', N'U') AS agent_memory_link,
       OBJECT_ID(N'dbo.agent_memory_setting', N'U') AS agent_memory_setting,
       OBJECT_ID(N'dbo.agent_memory_run', N'U') AS agent_memory_run,
       (SELECT COUNT(*) FROM dbo.agent_memory_setting) AS ajustes;
