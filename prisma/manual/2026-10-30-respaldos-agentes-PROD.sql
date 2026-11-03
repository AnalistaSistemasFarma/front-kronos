/*
  PASE MANUAL (PRODUCCIÓN) — Auditoría de agentes → Copias de seguridad de los agentes (2026-10-30).
  QUÉ HACE (idempotente; solo crea lo que falta):
    - dbo.agent_backup_run    cada copia (completa, horaria o subida del espejo) de cada máquina, con
                              inicio, fin, duración, resultado, avisos y bases SQLite copiadas. La llena
                              el recolector desde los registros de cada Mac (solo lectura).
    - dbo.agent_backup_host   estado de cada máquina: si respondió al recolector, agentes y archivos.
    - dbo.agent_backup_check  resultado de la validación semanal (domingos) por máquina.
  Sin modelo Prisma (lib/agent-audit/backups-db.ts). REVERSA: …-respaldos-agentes-reversa.sql
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB'
  THROW 51601, N'Base no esperada: este script es solo para KRONOSDB.', 1;
SET XACT_ABORT ON;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[agent_backup_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_backup_run] (
    [id_run]       BIGINT IDENTITY(1,1) NOT NULL,
    [maquina]      NVARCHAR(40)   NOT NULL,
    [modo]         NVARCHAR(20)   NOT NULL,    -- completo | horario | subida
    [inicio]       DATETIME2(0)   NOT NULL,    -- UTC
    [fin]          DATETIME2(0)   NULL,        -- UTC; NULL = sin terminar
    [segundos]     INT            NULL,
    [resultado]    NVARCHAR(20)   NOT NULL,    -- ok | con_avisos | fallo | sin_terminar
    [avisos]       INT            NOT NULL CONSTRAINT [DF_abr_avisos] DEFAULT (0),
    [sqlite]       INT            NULL,
    [detalle]      NVARCHAR(1000) NULL,
    [recolectado_at] DATETIME2(0) NOT NULL,
    CONSTRAINT [PK_agent_backup_run] PRIMARY KEY ([id_run])
  );
  CREATE UNIQUE INDEX [UX_agent_backup_run] ON [dbo].[agent_backup_run]([maquina], [modo], [inicio]);
  CREATE INDEX [IX_agent_backup_run_fin] ON [dbo].[agent_backup_run]([fin]);
END;
IF OBJECT_ID(N'[dbo].[agent_backup_host]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_backup_host] (
    [maquina]        NVARCHAR(40)   NOT NULL,
    [etiqueta]       NVARCHAR(80)   NULL,
    [alcanzable]     BIT            NOT NULL,
    [ultimo_intento] DATETIME2(0)   NOT NULL,
    [ultimo_contacto] DATETIME2(0)  NULL,
    [error]          NVARCHAR(300)  NULL,
    [agentes]        INT            NULL,
    [archivos]       INT            NULL,
    CONSTRAINT [PK_agent_backup_host] PRIMARY KEY ([maquina])
  );
END;
IF OBJECT_ID(N'[dbo].[agent_backup_check]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_backup_check] (
    [id_check]   INT IDENTITY(1,1) NOT NULL,
    [fecha]      DATE           NOT NULL,
    [maquina]    NVARCHAR(40)   NOT NULL,
    [estado]     NVARCHAR(20)   NOT NULL,      -- ok | avisos | problemas
    [problemas]  NVARCHAR(2000) NULL,
    [avisos]     NVARCHAR(2000) NULL,
    [datos_json] NVARCHAR(MAX)  NULL,
    CONSTRAINT [PK_agent_backup_check] PRIMARY KEY ([id_check])
  );
  CREATE UNIQUE INDEX [UX_agent_backup_check] ON [dbo].[agent_backup_check]([fecha], [maquina]);
END;
COMMIT TRAN; END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_backup_run', N'U') AS agent_backup_run,
       OBJECT_ID(N'dbo.agent_backup_host', N'U') AS agent_backup_host, OBJECT_ID(N'dbo.agent_backup_check', N'U') AS agent_backup_check;
