/*
  Migración: MÓDULO CORREO — ADITIVA. 2026-10-15.

  Idea de Nicolás Rivera (2026-10-15) para Jurídica (Laura Ayala): cada persona
  ve SU buzón de Outlook en SynerLink, revisa hilos, responde sobre un hilo y convierte correos en solicitudes con
  simulación previa; los hilos quedan vinculados a su solicitud.

  Crea 3 tablas NUEVAS en dbo (no toca ninguna tabla existente):
    1. email_thread_link     hilo (conversationId) ↔ solicitud; único por (persona, hilo).
    2. email_thread_message  correos (internetMessageId) ya registrados en un hilo; ÚNICO global
                             (idempotencia: un correo no crea dos solicitudes ni dos notas).
    3. email_audit           auditoría inmutable (TR_email_audit_inmutable) de CADA lectura del
                             buzón (bandeja, hilo, adjunto) y de cada envío y conversión.

  Graph se consulta con la app de APLICACIÓN del inquilino (decisión de Nicolás Rivera,
  2026-10-15 10:26). No hay tokens en la base: el token vive solo en la memoria del servidor.

  Privacidad (Ley 1581 de 2012): NO se guardan cuerpos de correo; solo
  identificadores, el asunto de la solicitud y la auditoría sin contenido.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO,
  primero en KRONOSDB_PRUEBAS y luego en KRONOSDB en ventana controlada.
  IDEMPOTENTE: cada objeto se crea solo si no existe (también corre sobre el
  esquema que deja `prisma db push` en la CI).
  Permiso del menú: prisma/manual/2026-10-15-correo-permiso.sql
  REVERSA: prisma/manual/2026-10-15-correo-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.email_thread_link', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_thread_link] (
      [id]              INT IDENTITY(1,1) NOT NULL,
      [id_user]         NVARCHAR(50)   NOT NULL,
      [mailbox]         NVARCHAR(320)  NOT NULL,
      [conversation_id] NVARCHAR(512)  NOT NULL,
      [id_request]      INT            NULL,
      [estado]          NVARCHAR(10)   NOT NULL CONSTRAINT [email_thread_link_estado_df] DEFAULT 'ACTIVO',
      [origen]          NVARCHAR(10)   NOT NULL,
      [asunto]          NVARCHAR(255)  NULL,
      [created_by]      NVARCHAR(50)   NOT NULL,
      [created_at]      DATETIME2      NOT NULL CONSTRAINT [email_thread_link_created_at_df] DEFAULT sysutcdatetime(),
      [last_synced_at]  DATETIME2      NULL,
      CONSTRAINT [email_thread_link_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [UQ_email_thread_link_hilo] UNIQUE NONCLUSTERED ([id_user], [conversation_id])
    );
    CREATE NONCLUSTERED INDEX [IX_email_thread_link_request] ON [dbo].[email_thread_link]([id_request]);
  END

  IF OBJECT_ID(N'dbo.email_thread_message', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_thread_message] (
      [id]                  BIGINT IDENTITY(1,1) NOT NULL,
      [id_link]             INT            NOT NULL,
      [internet_message_id] NVARCHAR(512)  NOT NULL,
      [tipo]                NVARCHAR(10)   NOT NULL,
      [received_at]         DATETIME2      NULL,
      [created_at]          DATETIME2      NOT NULL CONSTRAINT [email_thread_message_created_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [email_thread_message_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [UQ_email_thread_message_imid] UNIQUE NONCLUSTERED ([internet_message_id]),
      CONSTRAINT [email_thread_message_id_link_fkey] FOREIGN KEY ([id_link]) REFERENCES [dbo].[email_thread_link]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
    CREATE NONCLUSTERED INDEX [IX_email_thread_message_link] ON [dbo].[email_thread_message]([id_link]);
  END

  IF OBJECT_ID(N'dbo.email_audit', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_audit] (
      [id]                  BIGINT IDENTITY(1,1) NOT NULL,
      [id_user]             NVARCHAR(50)   NOT NULL,
      [mailbox]             NVARCHAR(320)  NULL,
      [accion]              NVARCHAR(30)   NOT NULL,
      [mensaje_id]          NVARCHAR(512)  NULL,
      [conversation_id]     NVARCHAR(512)  NULL,
      [internet_message_id] NVARCHAR(512)  NULL,
      [id_request]          INT            NULL,
      [detalle]             NVARCHAR(1000) NULL,
      [ip]                  NVARCHAR(64)   NULL,
      [created_at]          DATETIME2      NOT NULL CONSTRAINT [email_audit_created_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [email_audit_pkey] PRIMARY KEY CLUSTERED ([id])
    );
    CREATE NONCLUSTERED INDEX [IX_email_audit_user] ON [dbo].[email_audit]([id_user], [created_at]);
    CREATE NONCLUSTERED INDEX [IX_email_audit_request] ON [dbo].[email_audit]([id_request]);
  END

  /* Restricciones CHECK (db push no las crea: se agregan aquí también sobre su esquema). */
  IF OBJECT_ID(N'dbo.CK_email_thread_link_estado', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_thread_link] ADD CONSTRAINT [CK_email_thread_link_estado] CHECK ([estado] IN (N''CREANDO'', N''ACTIVO''))');
  IF OBJECT_ID(N'dbo.CK_email_thread_link_origen', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_thread_link] ADD CONSTRAINT [CK_email_thread_link_origen] CHECK ([origen] IN (N''CREADA'', N''VINCULADA''))');
  IF OBJECT_ID(N'dbo.CK_email_thread_link_activo', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_thread_link] ADD CONSTRAINT [CK_email_thread_link_activo] CHECK ([estado] = N''CREANDO'' OR [id_request] IS NOT NULL)');
  IF OBJECT_ID(N'dbo.CK_email_thread_message_tipo', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_thread_message] ADD CONSTRAINT [CK_email_thread_message_tipo] CHECK ([tipo] IN (N''ORIGEN'', N''NOTA'', N''RESPUESTA''))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Auditoría inmutable (CREATE OR ALTER: idempotente). Trigger de UPDATE/DELETE, nunca de
   INSERT: Prisma inserta con OUTPUT sin INTO, que SQL Server no admite con trigger de INSERT. */
EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_email_audit_inmutable] ON [dbo].[email_audit]
INSTEAD OF UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51400, N''La auditoría del módulo Correo no se puede editar ni borrar.'', 1;
END');
