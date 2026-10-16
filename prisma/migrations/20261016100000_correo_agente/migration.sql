/*
  Migración: CORREO · «CONSULTAR A UN AGENTE» — ADITIVA. 2026-10-16.

  Diseño aprobado por Nicolás Rivera (2026-10-16 09:24–09:27 COT): desde un hilo del
  módulo Correo, la persona comparte ESE hilo con UNO de sus agentes del chat. El agente
  lo lee y PROPONE (respuesta en el hilo, solicitud vinculada, nota del caso); nada se
  ejecuta sin el clic de la persona: «obviamente es una decisión del usuario, no del
  agente autónomamente».

  Crea 2 tablas NUEVAS en dbo (no toca ninguna tabla existente):
    1. email_agent_share   concesión persona → agente sobre UN hilo (conversationId) de SU
                           buzón, por 24 h, revocable. `token` = share_id opaco del agente.
    2. email_agent_action  propuesta del agente (RESPUESTA | SOLICITUD | NOTA) que queda
                           PENDIENTE hasta que la persona la confirma o la descarta.

  La auditoría va en la tabla existente dbo.email_audit (inmutable) con acciones nuevas:
  COMPARTIR_AGENTE, REVOCAR_AGENTE, AGENTE_LEER_HILO, AGENTE_LEER_ADJUNTO,
  AGENTE_PROPONER, AGENTE_DENEGADO, AGENTE_CONFIRMAR, AGENTE_DESCARTAR, AGENTE_FALLIDO
  (la columna accion es texto libre de 30: no requiere DDL).

  Privacidad: NO se guardan cuerpos de los correos recibidos. Sí queda el texto que el
  agente PROPONE (payload) como constancia de lo que la persona confirmó.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con
  respaldo COPY_ONLY, primero en KRONOSDB_PRUEBAS y luego en KRONOSDB en ventana.
  IDEMPOTENTE (también corre sobre el esquema que deja `prisma db push` en la CI).
  REVERSA: prisma/manual/2026-10-16-correo-agente-reversa.sql
*/

SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51430, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.email_agent_share', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_agent_share] (
      [id]                   INT IDENTITY(1,1) NOT NULL,
      [token]                NVARCHAR(64)   NOT NULL,
      [id_user]              NVARCHAR(50)   NOT NULL,
      [mailbox]              NVARCHAR(320)  NOT NULL,
      [conversation_id]      NVARCHAR(512)  NOT NULL,
      [asunto]               NVARCHAR(255)  NULL,
      [id_agent]             INT            NOT NULL,
      [id_chat_conversation] INT            NOT NULL,
      [created_at]           DATETIME2      NOT NULL CONSTRAINT [email_agent_share_created_at_df] DEFAULT sysutcdatetime(),
      [expires_at]           DATETIME2      NOT NULL,
      [revoked_at]           DATETIME2      NULL,
      [revoked_by]           NVARCHAR(50)   NULL,
      CONSTRAINT [email_agent_share_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [UQ_email_agent_share_token] UNIQUE NONCLUSTERED ([token])
    );
    CREATE NONCLUSTERED INDEX [IX_email_agent_share_hilo] ON [dbo].[email_agent_share]([id_user], [conversation_id]);
    CREATE NONCLUSTERED INDEX [IX_email_agent_share_chat] ON [dbo].[email_agent_share]([id_chat_conversation]);
  END

  IF OBJECT_ID(N'dbo.email_agent_action', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_agent_action] (
      [id]              INT IDENTITY(1,1) NOT NULL,
      [id_share]        INT            NOT NULL,
      [id_agent]        INT            NOT NULL,
      [tipo]            NVARCHAR(12)   NOT NULL,
      [estado]          NVARCHAR(12)   NOT NULL CONSTRAINT [email_agent_action_estado_df] DEFAULT 'PENDIENTE',
      [payload]         NVARCHAR(MAX)  NOT NULL,
      [id_chat_message] INT            NULL,
      [created_at]      DATETIME2      NOT NULL CONSTRAINT [email_agent_action_created_at_df] DEFAULT sysutcdatetime(),
      [decided_at]      DATETIME2      NULL,
      [decided_by]      NVARCHAR(50)   NULL,
      [resultado]       NVARCHAR(1000) NULL,
      [id_request]      INT            NULL,
      CONSTRAINT [email_agent_action_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [email_agent_action_id_share_fkey] FOREIGN KEY ([id_share]) REFERENCES [dbo].[email_agent_share]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
    CREATE NONCLUSTERED INDEX [IX_email_agent_action_share] ON [dbo].[email_agent_action]([id_share]);
    CREATE NONCLUSTERED INDEX [IX_email_agent_action_mensaje] ON [dbo].[email_agent_action]([id_chat_message]);
  END

  /* Restricciones CHECK (db push no las crea: se agregan aquí también sobre su esquema). */
  IF OBJECT_ID(N'dbo.CK_email_agent_action_tipo', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_agent_action] ADD CONSTRAINT [CK_email_agent_action_tipo] CHECK ([tipo] IN (N''RESPUESTA'', N''SOLICITUD'', N''NOTA''))');
  IF OBJECT_ID(N'dbo.CK_email_agent_action_estado', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_agent_action] ADD CONSTRAINT [CK_email_agent_action_estado] CHECK ([estado] IN (N''PENDIENTE'', N''EJECUTANDO'', N''CONFIRMADA'', N''DESCARTADA'', N''FALLIDA''))');
  IF OBJECT_ID(N'dbo.CK_email_agent_share_vigencia', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_agent_share] ADD CONSTRAINT [CK_email_agent_share_vigencia] CHECK ([expires_at] > [created_at] AND [expires_at] <= DATEADD(HOUR, 25, [created_at]))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
