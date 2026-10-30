/*
  PASE MANUAL (PRODUCCIÓN) — Auditoría de agentes → Casos de uso (2026-10-29).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca tablas existentes):
    - dbo.agent_use_summary  por agente y corte: para qué se usa, nivel de uso, cifras medidas
                             (tareas, personas, horas netas estimadas) y observaciones.
    - dbo.agent_use_case     casos de uso por agente y corte: lo que ha hecho (tipo 'hecho', con
                             su recurrencia medida) y lo que está haciendo (tipo 'en_curso').
  Los datos los carga el análisis de conversaciones (justificación de la IA); cada corte es una
  foto, y la pantalla muestra el más reciente.

  Sin modelo Prisma (lib/agent-audit/use-cases-db.ts usa withMssqlPool): no exige prisma generate.
  REVERSA: prisma/manual/2026-10-29-casos-de-uso-agentes-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB'
  THROW 51581, N'Base no esperada: este script es solo para KRONOSDB.', 1;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[agent_use_summary]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_use_summary] (
    [id_summary]      INT IDENTITY(1,1) NOT NULL,
    [id_agent]        INT            NOT NULL,
    [corte]           DATE           NOT NULL,
    [periodo_desde]   DATE           NOT NULL,
    [rol_resumen]     NVARCHAR(1000) NULL,
    [nivel_uso]       NVARCHAR(20)   NOT NULL,
    [departamento]    NVARCHAR(120)  NULL,
    [tareas]          INT            NOT NULL CONSTRAINT [DF_aus_tareas] DEFAULT (0),
    [tareas_recientes] INT           NOT NULL CONSTRAINT [DF_aus_rec] DEFAULT (0),
    [personas]        INT            NOT NULL CONSTRAINT [DF_aus_pers] DEFAULT (0),
    [horas_bajo]      INT            NULL,
    [horas_base]      INT            NULL,
    [horas_alto]      INT            NULL,
    [observaciones]   NVARCHAR(2000) NULL,
    [created_at]      DATETIME2(0)   NOT NULL CONSTRAINT [DF_aus_created] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_agent_use_summary] PRIMARY KEY ([id_summary]),
    CONSTRAINT [FK_agent_use_summary_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX [UX_agent_use_summary] ON [dbo].[agent_use_summary]([id_agent], [corte]);
END;
IF OBJECT_ID(N'[dbo].[agent_use_case]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_use_case] (
    [id_case]        INT IDENTITY(1,1) NOT NULL,
    [id_agent]       INT            NOT NULL,
    [corte]          DATE           NOT NULL,
    [tipo]           NVARCHAR(20)   NOT NULL,   -- 'hecho' | 'en_curso'
    [caso]           NVARCHAR(300)  NOT NULL,
    [descripcion]    NVARCHAR(1000) NULL,
    [clase]          NVARCHAR(30)   NULL,       -- Recurrente | Ocasional | Puntual | Sin evidencia en el chat | (en curso: activo/en_espera/recurrente)
    [ritmo]          NVARCHAR(30)   NULL,
    [veces]          INT            NULL,
    [veces_mes]      DECIMAL(6,1)   NULL,
    [dias]           INT            NULL,
    [semanas]        INT            NULL,
    [personas]       INT            NULL,
    [primera]        DATE           NULL,
    [ultima]         DATE           NULL,
    [area]           NVARCHAR(120)  NULL,
    [sistemas]       NVARCHAR(300)  NULL,
    [entregable]     NVARCHAR(300)  NULL,
    [candidato_automatizar] BIT     NOT NULL CONSTRAINT [DF_auc_cand] DEFAULT (0),
    CONSTRAINT [PK_agent_use_case] PRIMARY KEY ([id_case]),
    CONSTRAINT [FK_agent_use_case_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_agent_use_case_corte] ON [dbo].[agent_use_case]([corte], [id_agent], [tipo]);
END;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_use_summary', N'U') AS agent_use_summary, OBJECT_ID(N'dbo.agent_use_case', N'U') AS agent_use_case;
