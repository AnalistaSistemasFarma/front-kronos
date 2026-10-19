/*
  PASE MANUAL — cierre automático al terminar de firmar (Solicitudes generales).

  QUÉ ES: crea dbo.user_signature_auto_close, donde cada solicitante guarda si quiere
  que sus solicitudes se cierren solas cuando todos los documentos quedan firmados
  (interruptor arriba de la lista de sus solicitudes). Una fila por usuario; sin fila
  = desactivado (valor por defecto). Se corre A MANO, como los demás pases de
  prisma/manual (las migraciones no corren en los despliegues).

  ADITIVO: solo crea la tabla nueva. No toca ninguna tabla existente.

  ORDEN: primero este script, después el código. Si el código saliera antes, el
  interruptor dice "aún no disponible" y las firmas siguen funcionando como siempre
  (sin cierre automático).

  Idempotente: se puede correr dos veces. Reversa:
  prisma/manual/2026-10-16-user-signature-auto-close-reversa.sql
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

/* Estado ANTES */
SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[user_signature_auto_close] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_user] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [user_signature_auto_close_enabled_df] DEFAULT 0,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [user_signature_auto_close_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_signature_auto_close_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_signature_auto_close_id_user_fkey] FOREIGN KEY ([id_user])
      REFERENCES [dbo].[user] ([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'user_signature_auto_close_id_user_key'
    AND object_id = OBJECT_ID(N'[dbo].[user_signature_auto_close]')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [user_signature_auto_close_id_user_key]
    ON [dbo].[user_signature_auto_close] ([id_user]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW;

END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[user_signature_auto_close]', N'U') AS user_signature_auto_close_object_id;

/*
  ESTADO POR AMBIENTE
  - KRONOSDB_PRUEBAS: pendiente.
  - KRONOSDB (producción): solo con autorización.
*/
