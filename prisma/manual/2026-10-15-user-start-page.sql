/*
  PASE MANUAL — página de inicio personalizada (Perfil → Accesibilidad).

  QUÉ ES: crea dbo.user_start_page, donde cada persona guarda la página que se abre
  primero al entrar a SynerLink (una fila por usuario). Se corre A MANO, como los
  demás pases de prisma/manual (las migraciones no corren en los despliegues).

  ADITIVO: solo crea la tabla nueva. No toca ninguna tabla existente.

  ORDEN: primero este script, después el código. Si el código saliera antes, la
  opción del perfil dice "aún no disponible" y el inicio sigue siendo el de siempre
  (/home ignora la preferencia si la tabla no existe).

  Idempotente: se puede correr dos veces. Reversa:
  prisma/manual/2026-10-15-user-start-page-reversa.sql
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

/* Estado ANTES */
SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[user_start_page]', N'U') AS user_start_page_object_id;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[user_start_page]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[user_start_page] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_user] NVARCHAR(1000) NOT NULL,
    [url] NVARCHAR(400) NOT NULL,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [user_start_page_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_start_page_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_start_page_id_user_fkey] FOREIGN KEY ([id_user])
      REFERENCES [dbo].[user] ([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'user_start_page_id_user_key' AND object_id = OBJECT_ID(N'[dbo].[user_start_page]')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [user_start_page_id_user_key]
    ON [dbo].[user_start_page] ([id_user]);
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
SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[user_start_page]', N'U') AS user_start_page_object_id;

/*
  ESTADO POR AMBIENTE
  - KRONOSDB_PRUEBAS: aplicado el 2026-10-15 (tabla creada, 4 columnas verificadas).
  - KRONOSDB (producción): solo con autorización.
*/
