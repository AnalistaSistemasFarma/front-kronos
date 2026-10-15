/*
  PASE MANUAL (OPCIONAL) — Módulo «Correo»: tarea de fondo que pasa a notas de cada caso
  los correos nuevos de los hilos vinculados. Se siembra APAGADA (active = 0).

  APAGADA POR PARTIDA DOBLE hasta que Nicolás la apruebe:
    1. Esta fila queda con active = 0 (el programador no la ejecuta).
    2. Aunque se active, el handler no hace nada sin CORREO_SYNC_HABILITADO=true en el .env.
  Para encenderla (solo con aprobación): UPDATE dbo.scheduled_job SET active = 1
  WHERE job_type = N'correo_sincronizar_hilos';  y CORREO_SYNC_HABILITADO=true + reinicio.

  Cada 15 minutos, máximo 50 hilos por corrida. Idempotente.
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
  REVERSA: DELETE FROM dbo.scheduled_job WHERE job_type = N'correo_sincronizar_hilos';
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51430, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.email_thread_link', N'U') IS NULL
  THROW 51431, N'Falta la migración 20261015120000_correo_modulo (tablas email_*).', 1;

DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';

/* Todo por SQL dinámico: si scheduled_job no existe (base de la CI), no se compila nada contra ella. */
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
BEGIN
  DECLARE @Next DATETIME = DATEADD(MINUTE, 15, GETDATE());
  EXEC sp_executesql N'IF NOT EXISTS (SELECT 1 FROM [dbo].[scheduled_job] WHERE job_type = N''correo_sincronizar_hilos'')
    INSERT INTO [dbo].[scheduled_job] (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
    VALUES (N''Correo · correos nuevos de hilos vinculados → notas del caso'', N''correo_sincronizar_hilos'', N''{"limite":50}'', N''*/15 * * * *'', @Next, 0, N''correo'', @Actor, GETDATE());',
    N'@Next DATETIME, @Actor NVARCHAR(255)', @Next = @Next, @Actor = @Actor;
END;

IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT DB_NAME() AS base, name, job_type, cron_expression, active FROM [dbo].[scheduled_job] WHERE job_type = N''correo_sincronizar_hilos'';';
