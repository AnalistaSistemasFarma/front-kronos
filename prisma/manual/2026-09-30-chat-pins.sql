/*
  PASE MANUAL — anclas de la barra lateral del chat de SynerLink.
  Aprobado por Nicolás Rivera el 2026-09-30.

  QUÉ ES: el DDL de la migración 20260930180000_chat_pins, para correrlo A
  MANO (las migraciones no corren en los despliegues: la base de producción no
  está baselined, P3005). Ver la memoria "correr-sql-servidores-front-kronos":
  script Node con `mssql` leyendo DATABASE_URL del .env.

  ADITIVO: solo crea la tabla nueva dbo.chat_pin. No toca ninguna tabla
  existente, así que no toma bloqueos sobre las tablas del chat en uso.

  ORDEN: primero este script, después el código. Si el código saliera antes, lo
  único que falla es anclar (la ruta responde "sin anclas"); el chat sigue.

  Idempotente: se puede correr dos veces. Reversa:
  prisma/manual/2026-09-30-chat-pins-reversa.sql
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

/* Estado ANTES */
SELECT 'antes' AS momento, OBJECT_ID(N'[dbo].[chat_pin]', N'U') AS chat_pin_object_id;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_pin]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_pin] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_user] NVARCHAR(1000) NOT NULL,
    [target_key] NVARCHAR(60) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_pin_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_pin_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [chat_pin_id_user_fkey] FOREIGN KEY ([id_user])
      REFERENCES [dbo].[user] ([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'chat_pin_user_target_key' AND object_id = OBJECT_ID(N'[dbo].[chat_pin]')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [chat_pin_user_target_key]
    ON [dbo].[chat_pin] ([id_user], [target_key]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

/* Estado DESPUÉS */
SELECT 'despues' AS momento, OBJECT_ID(N'[dbo].[chat_pin]', N'U') AS chat_pin_object_id;
SELECT 'despues' AS momento, name AS indice FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[chat_pin]');

/*
  ESTADO POR AMBIENTE
  - KRONOSDB_PRUEBAS: aplicado el 2026-09-30 (~20:25 UTC) y registrado en
    _prisma_migrations (22:01 UTC). Corrido 2 veces, sin cambios la segunda.
  - PRODUCCIÓN (KRONOSDB): PENDIENTE. Correr este archivo A MANO, antes de
    promover el código a main y solo con autorización de Nicolás:
      1. Script Node + mssql en serfarma05 (memoria
         correr-sql-servidores-front-kronos), verificando DB_NAME() = KRONOSDB.
      2. Revisar la salida "despues": object_id no nulo e índices
         chat_pin_pkey y chat_pin_user_target_key.
      3. Si hace falta, registrar la migración:
         npx prisma migrate resolve --applied 20260930180000_chat_pins
    Reversa: prisma/manual/2026-09-30-chat-pins-reversa.sql.
*/
