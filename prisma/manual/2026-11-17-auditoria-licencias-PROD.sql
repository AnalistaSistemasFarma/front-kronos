/*
  PASE MANUAL (PRODUCCIÓN) — Auditoría de agentes → Costos y licencias (2026-11-17, pedido de Nicolás).
  QUÉ HACE (idempotente; solo crea lo que falta; no toca datos existentes):
    - dbo.ai_license               licencias de Anthropic: empresa que la PAGA, plan, costo, organización, renovación.
    - dbo.ai_license_token         huella (12 hex del SHA-256) de cada token → licencia. Nunca el token.
    - dbo.ai_license_agent         qué licencia usa cada agente (asignación manual o confirmada).
    - dbo.chat_agent_quota_history historial del cupo semanal (máx. una fila por agente y hora) para promedios de 4 semanas.
    - dbo.chat_agent_quota         + columnas token_fp y org_fp (huellas declaradas por el puente; NULL si no las manda).
  Sin modelo Prisma (lib/agent-audit/licencias-db.ts). Riesgo de bloqueo: bajo (CREATE TABLE y un ALTER ADD
  de columnas NULL sobre chat_agent_quota, ~45 filas; LOCK_TIMEOUT 5 s). REVERSA: …-auditoria-licencias-reversa.sql
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51702, N'Base no esperada para este script.', 1;
SET XACT_ABORT ON;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[ai_license]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_license] (
    [id_license]    INT IDENTITY(1,1) NOT NULL,
    [codigo]        NVARCHAR(10)   NOT NULL,             -- L01, L02…
    [nombre]        NVARCHAR(120)  NULL,
    [id_company]    INT            NOT NULL,             -- empresa que PAGA la licencia (regla: no se mezcla)
    [organizacion]  NVARCHAR(40)   NULL,                 -- nombre o huella de la organización de Anthropic
    [plan]          NVARCHAR(40)   NULL,                 -- Pro, Max, Team…
    [costo_mensual] DECIMAL(12,2)  NULL,
    [moneda]        NVARCHAR(3)    NOT NULL CONSTRAINT [DF_ail_moneda] DEFAULT (N'USD'),
    [renovacion]    DATE           NULL,
    [responsable]   NVARCHAR(200)  NULL,
    [notas]         NVARCHAR(500)  NULL,
    [activa]        BIT            NOT NULL CONSTRAINT [DF_ail_activa] DEFAULT (1),
    [updated_at]    DATETIME2(0)   NOT NULL CONSTRAINT [DF_ail_upd] DEFAULT (SYSUTCDATETIME()),
    [updated_by]    NVARCHAR(200)  NULL,
    CONSTRAINT [PK_ai_license] PRIMARY KEY ([id_license])
  );
  CREATE UNIQUE INDEX [UX_ai_license_codigo] ON [dbo].[ai_license]([codigo]);
END;
IF OBJECT_ID(N'[dbo].[ai_license_token]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_license_token] (
    [huella]      NVARCHAR(16)  NOT NULL,                -- 12 primeros hex del SHA-256 del token (NUNCA el token)
    [id_license]  INT           NOT NULL,
    [estado]      NVARCHAR(20)  NOT NULL CONSTRAINT [DF_ailt_estado] DEFAULT (N'activo'),  -- activo | revocar
    [notas]       NVARCHAR(300) NULL,
    [created_at]  DATETIME2(0)  NOT NULL CONSTRAINT [DF_ailt_cre] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_ai_license_token] PRIMARY KEY ([huella])
  );
  CREATE INDEX [IX_ai_license_token_lic] ON [dbo].[ai_license_token]([id_license]);
END;
IF OBJECT_ID(N'[dbo].[ai_license_agent]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_license_agent] (
    [id_agent]    INT           NOT NULL,                -- un agente usa UNA licencia
    [id_license]  INT           NOT NULL,
    [updated_at]  DATETIME2(0)  NOT NULL CONSTRAINT [DF_aila_upd] DEFAULT (SYSUTCDATETIME()),
    [updated_by]  NVARCHAR(200) NULL,
    CONSTRAINT [PK_ai_license_agent] PRIMARY KEY ([id_agent])
  );
  CREATE INDEX [IX_ai_license_agent_lic] ON [dbo].[ai_license_agent]([id_license]);
END;
IF OBJECT_ID(N'[dbo].[chat_agent_quota_history]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_quota_history] (
    [id]             BIGINT IDENTITY(1,1) NOT NULL,
    [id_agent]       INT           NOT NULL,
    [utilization_7d] FLOAT         NULL,
    [reset_7d]       DATETIME2(0)  NULL,
    [utilization_5h] FLOAT         NULL,
    [overage]        NVARCHAR(40)  NULL,
    [token_fp]       NVARCHAR(16)  NULL,
    [org_fp]         NVARCHAR(16)  NULL,
    [measured_at]    DATETIME2(0)  NOT NULL,
    [source]         NVARCHAR(20)  NOT NULL,
    CONSTRAINT [PK_chat_agent_quota_history] PRIMARY KEY ([id])
  );
  CREATE INDEX [IX_caqh_agent_fecha] ON [dbo].[chat_agent_quota_history]([id_agent], [measured_at]);
END;
IF OBJECT_ID(N'[dbo].[chat_agent_quota]', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.chat_agent_quota', N'token_fp') IS NULL
  ALTER TABLE [dbo].[chat_agent_quota] ADD [token_fp] NVARCHAR(16) NULL, [org_fp] NVARCHAR(16) NULL;
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
