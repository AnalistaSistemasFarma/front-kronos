/*
  Proyectos — MESAS DE DISCUSIÓN entre agentes (2026-11-04). Diseño: docs/proyectos-mesas-discusion.md.

  QUÉ HACE (idempotente; solo crea lo que falta):
    - chat_project_mesa          una mesa = una conversación de proyecto + tema + reglas + puntero de turno
    - chat_project_mesa_agente   participantes (rol y orden)
    - chat_project_mesa_evento   registro INMUTABLE (trigger) de todo lo que pasa en la mesa
    - chat_message.event_type    el CHECK admite también 'mesa_turno' (aviso de turno de sistema)
*/
SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_mesa]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_mesa] (
    [id_mesa]            INT            IDENTITY(1,1) NOT NULL,
    [id_project]         INT            NOT NULL,
    [id_conversation]    INT            NOT NULL,
    [tema]               NVARCHAR(2000) NOT NULL,
    [estado]             NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_mesa_estado_df] DEFAULT N'activa',
    [motivo_pausa]       NVARCHAR(20)   NULL,
    [id_agent_moderador] INT            NOT NULL,
    [ritmo_min]          INT            NOT NULL,
    [tope_dia]           INT            NOT NULL,
    [sintesis_cada]      INT            NOT NULL,
    [horario_desde]      INT            NOT NULL,
    [horario_hasta]      INT            NOT NULL,
    [solo_habiles]       BIT            NOT NULL,
    [ronda]              INT            NOT NULL CONSTRAINT [chat_project_mesa_ronda_df] DEFAULT 0,
    [turno_idx]          INT            NOT NULL CONSTRAINT [chat_project_mesa_turno_idx_df] DEFAULT -1,
    [turno_desde]        DATETIME2      NULL,
    [id_message_turno]   INT            NULL,
    [proximo_turno_at]   DATETIME2      NULL,
    [turnos_hoy]         INT            NOT NULL CONSTRAINT [chat_project_mesa_turnos_hoy_df] DEFAULT 0,
    [turnos_dia]         NVARCHAR(10)   NULL,
    [aportes_ronda]      INT            NOT NULL CONSTRAINT [chat_project_mesa_aportes_df] DEFAULT 0,
    [created_by]         NVARCHAR(1000) NOT NULL,
    [created_at]         DATETIME2      NOT NULL CONSTRAINT [chat_project_mesa_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]         DATETIME2      NOT NULL CONSTRAINT [chat_project_mesa_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_mesa_pkey] PRIMARY KEY CLUSTERED ([id_mesa]),
    CONSTRAINT [chat_project_mesa_conversation_key] UNIQUE NONCLUSTERED ([id_conversation]),
    CONSTRAINT [chat_project_mesa_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_mesa_conversation_fkey] FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_mesa_moderador_fkey] FOREIGN KEY ([id_agent_moderador]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_valores_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa] WITH CHECK ADD CONSTRAINT [chat_project_mesa_valores_ck]
    CHECK ([estado] IN (N''activa'', N''pausada'', N''cerrada'')
       AND ([motivo_pausa] IS NULL OR [motivo_pausa] IN (N''manual'', N''sin_aporte''))
       AND [ritmo_min] BETWEEN 10 AND 240 AND [tope_dia] BETWEEN 1 AND 200 AND [sintesis_cada] BETWEEN 1 AND 10
       AND [horario_desde] BETWEEN 0 AND 1440 AND [horario_hasta] BETWEEN 0 AND 1440 AND [horario_hasta] > [horario_desde]
       AND [turno_idx] >= -1 AND LEN([tema]) > 0);');

-- El motor perezoso busca las mesas activas con la próxima ronda vencida.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_mesa_motor_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_mesa]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_mesa_motor_idx] ON [dbo].[chat_project_mesa]([estado], [proximo_turno_at]) INCLUDE ([turno_idx], [turno_desde]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_mesa_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_mesa]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_mesa_project_idx] ON [dbo].[chat_project_mesa]([id_project]);');

IF OBJECT_ID(N'[dbo].[chat_project_mesa_agente]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_mesa_agente] (
    [id_mesa_agente] INT           IDENTITY(1,1) NOT NULL,
    [id_mesa]        INT           NOT NULL,
    [id_agent]       INT           NOT NULL,
    [rol]            NVARCHAR(80)  NOT NULL,
    [orden]          INT           NOT NULL,
    CONSTRAINT [chat_project_mesa_agente_pkey] PRIMARY KEY CLUSTERED ([id_mesa_agente]),
    CONSTRAINT [chat_project_mesa_agente_mesa_agent_key] UNIQUE NONCLUSTERED ([id_mesa], [id_agent]),
    CONSTRAINT [chat_project_mesa_agente_mesa_fkey] FOREIGN KEY ([id_mesa]) REFERENCES [dbo].[chat_project_mesa]([id_mesa]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_mesa_agente_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'[dbo].[chat_project_mesa_evento]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_mesa_evento] (
    [id_evento]   INT            IDENTITY(1,1) NOT NULL,
    [id_mesa]     INT            NOT NULL,
    [tipo]        NVARCHAR(30)   NOT NULL,
    [ronda]       INT            NULL,
    [id_agent]    INT            NULL,
    [id_user]     NVARCHAR(1000) NULL,
    [id_message]  INT            NULL,
    [detalle]     NVARCHAR(1000) NULL,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [chat_project_mesa_evento_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_mesa_evento_pkey] PRIMARY KEY CLUSTERED ([id_evento]),
    CONSTRAINT [chat_project_mesa_evento_mesa_fkey] FOREIGN KEY ([id_mesa]) REFERENCES [dbo].[chat_project_mesa]([id_mesa]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_mesa_evento_mesa_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_mesa_evento]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_mesa_evento_mesa_idx] ON [dbo].[chat_project_mesa_evento]([id_mesa], [id_evento]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa_evento] WITH CHECK ADD CONSTRAINT [chat_project_mesa_evento_tipo_ck]
    CHECK ([tipo] IN (N''creada'', N''turno'', N''respuesta'', N''vencido'', N''tope'', N''pausada'', N''reanudada'',
                      N''cerrada'', N''ronda_ahora'', N''reglas''));');

IF OBJECT_ID(N'[dbo].[TR_chat_project_mesa_evento_inmutable]', N'TR') IS NULL
  EXEC(N'CREATE TRIGGER [dbo].[TR_chat_project_mesa_evento_inmutable] ON [dbo].[chat_project_mesa_evento]
    INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      THROW 51581, N''El registro de las mesas de discusión no se cambia ni se borra.'', 1;
    END;');

-- Aviso de turno = mensaje de sistema con event_type 'mesa_turno'.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_event_type_ck'
           AND definition NOT LIKE N'%mesa_turno%')
BEGIN
  ALTER TABLE [dbo].[chat_message] DROP CONSTRAINT [chat_message_event_type_ck];
  EXEC(N'ALTER TABLE [dbo].[chat_message] WITH CHECK ADD CONSTRAINT [chat_message_event_type_ck]
    CHECK ([event_type] IS NULL OR [event_type] IN (''nudge'', ''mesa_turno''));');
END;

COMMIT TRAN;
