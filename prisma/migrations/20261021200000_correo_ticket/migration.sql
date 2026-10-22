/*
  Migración: CORREO · «CREAR TICKET» desde un hilo — ADITIVA. 2026-10-21.

  Pedido de Nicolás Rivera (2026-10-21 17:47 COT): «solo para los de TI: que desde el módulo
  de correo puedan crear un ticket, igual como lo hacen con la solicitud, pero ahora un ticket».

  Crea UNA tabla NUEVA en dbo (no toca ninguna tabla existente, ni [case] ni email_thread_link):
    email_thread_case   relación hilo del buzón (conversationId) ↔ ticket de mesa de ayuda
                        ([case].id_case). Un ticket por hilo y persona: se reserva (CREANDO)
                        antes de insertar el caso y se activa (ACTIVO) con su número.

  La auditoría va en la tabla existente dbo.email_audit con la acción nueva CREAR_TICKET
  (la columna accion es texto libre de 30: no requiere DDL). No se guardan cuerpos de correo.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY: prisma/manual/2026-10-21-correo-ticket-PRUEBAS.sql y luego -PROD.sql (repiten el
  bloque DDL tal cual; lib/correo/__tests__/ticket.test.ts verifica que no se separen).
  IDEMPOTENTE (también corre sobre el esquema que deja `prisma db push` en la CI).
  REVERSA: prisma/manual/2026-10-21-correo-ticket-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51540, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.email_thread_case', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[email_thread_case] (
      [id]                  INT IDENTITY(1,1) NOT NULL,
      [id_user]             NVARCHAR(50)   NOT NULL,
      [mailbox]             NVARCHAR(320)  NOT NULL,
      [conversation_id]     NVARCHAR(512)  NOT NULL,
      [internet_message_id] NVARCHAR(512)  NULL,
      [id_case]             INT            NULL,
      [estado]              NVARCHAR(10)   NOT NULL CONSTRAINT [email_thread_case_estado_df] DEFAULT 'ACTIVO',
      [asunto]              NVARCHAR(255)  NULL,
      [created_by]          NVARCHAR(50)   NOT NULL,
      [created_at]          DATETIME2      NOT NULL CONSTRAINT [email_thread_case_created_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [email_thread_case_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [UQ_email_thread_case_hilo] UNIQUE NONCLUSTERED ([id_user], [conversation_id])
    );
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_email_thread_case_case' AND object_id = OBJECT_ID(N'dbo.email_thread_case'))
    EXEC (N'CREATE NONCLUSTERED INDEX [IX_email_thread_case_case] ON [dbo].[email_thread_case]([id_case])');

  /* CHECK (db push no lo crea: se agrega aquí también sobre su esquema). */
  IF OBJECT_ID(N'dbo.CK_email_thread_case_estado', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[email_thread_case] ADD CONSTRAINT [CK_email_thread_case_estado] CHECK (([estado] = N''CREANDO'' AND [id_case] IS NULL) OR ([estado] = N''ACTIVO'' AND [id_case] IS NOT NULL))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
