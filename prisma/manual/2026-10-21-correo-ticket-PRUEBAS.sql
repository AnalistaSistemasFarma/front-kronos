/*
  PASE MANUAL (PRUEBAS) — Correo · «Crear ticket» desde un hilo (2026-10-21).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261021200000_correo_ticket/migration.sql:
    la tabla NUEVA email_thread_case con su índice y su CHECK.

  ORDEN: ANTES del código. Sin la tabla, «Crear ticket» falla al reservar el hilo (error 500
  controlado: no se crea el ticket) y el resto del Correo sigue igual.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261021200000_correo_ticket
  REVERSA: prisma/manual/2026-10-21-correo-ticket-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51541, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

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

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.email_thread_case', N'U') AS email_thread_case;
