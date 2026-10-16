/*
  Migración: auditoria_hoja_de_vida_agentes (F2 — hoja de vida de los agentes)

  Pedido de Nicolás (2026-10-01): por cada agente registrado en SynerLink, una
  "hoja de vida" con su propósito, su dueño, quién lo usa, qué tiene (sale del
  inventario de F1), sus métricas, su historial y sus hallazgos, que se
  actualiza sola: métricas cada noche y un resumen semanal redactado con IA
  SOLO con datos estructurados (nunca con el texto de las conversaciones).

  SOLO AGREGA: cuatro tablas nuevas. No altera ninguna tabla existente (la
  tabla `agent` no se toca: el propósito y el dueño van en agent_profile).

    1. agent_profile        — propósito y dueño del agente (lo edita quien
                              tenga el permiso de configurar).
    2. agent_metrics_daily  — métricas por agente y día (hora de Colombia).
    3. agent_cv_entry       — línea de tiempo: alta, cambios de inventario
                              entre escaneos, hallazgos abiertos/cerrados y
                              cambios del perfil.
    4. agent_cv_summary     — resumen semanal redactado con IA.

  Igual que 20261002120000_auditoria_inventario_agentes: PK y FK en la misma
  sentencia, índices dentro de EXEC, agente en NO ACTION (un agente no se
  borra, se desactiva).

  ATENCIÓN: generada MANUALMENTE. En los despliegues no corre `migrate deploy`
  (la base no está baselined, P3005): se aplica a mano antes del pase, con el
  script de Node + mssql.

  Idempotente: se puede re-correr sin efecto.
*/

-- ── 1. Perfil (propósito y dueño) ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_profile')
BEGIN
  CREATE TABLE [dbo].[agent_profile] (
    [id_agent]    INT            NOT NULL,
    [purpose]     NVARCHAR(1000) NULL,
    [owner_name]  NVARCHAR(160)  NULL,
    [owner_email] NVARCHAR(255)  NULL,
    [updated_by]  NVARCHAR(255)  NULL,
    [updated_at]  DATETIME2      NOT NULL CONSTRAINT [DF_agent_profile_updated_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_profile] PRIMARY KEY CLUSTERED ([id_agent] ASC),
    CONSTRAINT [FK_agent_profile_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

-- ── 2. Métricas diarias ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_metrics_daily')
BEGIN
  CREATE TABLE [dbo].[agent_metrics_daily] (
    [id]                    INT IDENTITY(1,1) NOT NULL,
    [id_agent]              INT               NOT NULL,
    [day]                   DATE              NOT NULL,
    [messages_received]     INT               NOT NULL CONSTRAINT [DF_agent_metrics_daily_received] DEFAULT 0,
    [messages_sent]         INT               NOT NULL CONSTRAINT [DF_agent_metrics_daily_sent] DEFAULT 0,
    [active_users]          INT               NOT NULL CONSTRAINT [DF_agent_metrics_daily_users] DEFAULT 0,
    [conversations]         INT               NOT NULL CONSTRAINT [DF_agent_metrics_daily_convs] DEFAULT 0,
    [turns]                 INT               NOT NULL CONSTRAINT [DF_agent_metrics_daily_turns] DEFAULT 0,
    [input_tokens]          BIGINT            NOT NULL CONSTRAINT [DF_agent_metrics_daily_input] DEFAULT 0,
    [cache_creation_tokens] BIGINT            NOT NULL CONSTRAINT [DF_agent_metrics_daily_cc] DEFAULT 0,
    [cache_read_tokens]     BIGINT            NOT NULL CONSTRAINT [DF_agent_metrics_daily_cr] DEFAULT 0,
    [output_tokens]         BIGINT            NOT NULL CONSTRAINT [DF_agent_metrics_daily_output] DEFAULT 0,
    [total_tokens]          BIGINT            NOT NULL CONSTRAINT [DF_agent_metrics_daily_total] DEFAULT 0,
    [computed_at]           DATETIME2         NOT NULL CONSTRAINT [DF_agent_metrics_daily_computed_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_metrics_daily] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_metrics_daily_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_metrics_daily_id_agent_day_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_metrics_daily_id_agent_day_key]
    ON [dbo].[agent_metrics_daily] ([id_agent] ASC, [day] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_metrics_daily_day')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_metrics_daily_day]
    ON [dbo].[agent_metrics_daily] ([day] ASC)');
END

-- ── 3. Línea de tiempo (historial) ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_cv_entry')
BEGIN
  CREATE TABLE [dbo].[agent_cv_entry] (
    [id]          INT IDENTITY(1,1) NOT NULL,
    [id_agent]    INT               NOT NULL,
    [occurred_at] DATETIME2         NOT NULL,
    [kind]        NVARCHAR(30)      NOT NULL,
    [title]       NVARCHAR(300)     NOT NULL,
    [detail]      NVARCHAR(2000)    NULL,
    [source_ref]  NVARCHAR(120)     NOT NULL,
    [created_by]  NVARCHAR(255)     NULL,
    [created_at]  DATETIME2         NOT NULL CONSTRAINT [DF_agent_cv_entry_created_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_cv_entry] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_cv_entry_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_cv_entry_id_agent_source_ref_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_cv_entry_id_agent_source_ref_key]
    ON [dbo].[agent_cv_entry] ([id_agent] ASC, [source_ref] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_cv_entry_agent_occurred')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_cv_entry_agent_occurred]
    ON [dbo].[agent_cv_entry] ([id_agent] ASC, [occurred_at] DESC)');
END

-- ── 4. Resumen semanal ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_cv_summary')
BEGIN
  CREATE TABLE [dbo].[agent_cv_summary] (
    [id]           INT IDENTITY(1,1) NOT NULL,
    [id_agent]     INT               NOT NULL,
    [week_start]   DATE              NOT NULL,
    [summary]      NVARCHAR(4000)    NOT NULL,
    [model]        NVARCHAR(120)     NULL,
    [input_hash]   NVARCHAR(64)      NULL,
    [generated_at] DATETIME2         NOT NULL CONSTRAINT [DF_agent_cv_summary_generated_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_cv_summary] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_cv_summary_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_cv_summary_id_agent_week_start_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_cv_summary_id_agent_week_start_key]
    ON [dbo].[agent_cv_summary] ([id_agent] ASC, [week_start] ASC)');
END
