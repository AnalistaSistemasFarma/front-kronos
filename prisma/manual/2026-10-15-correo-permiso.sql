/*
  PASE MANUAL — Módulo «Correo»: subproceso-permiso del menú.
  Pedido de Nicolás Rivera, 2026-10-15 (Jurídica, Laura Ayala).

  PRERREQUISITO: prisma/migrations/20261015120000_correo_modulo (tablas email_*).
  Si falta, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente; solo inserta):
    1. Proceso contenedor del menú: «Solicitudes» (si no existe, lo crea).
    2. Subproceso-permiso (igual a lib/correo/constants.ts):
         /process/correo   Correo   (entrada del menú; ver su propio buzón, responder,
                                     crear solicitudes en las empresas donde tenga el permiso)
    3. NO otorga permisos a nadie: queda APAGADO por defecto y se habilita por persona y
       empresa en Administración → Usuarios.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  REVERSA: prisma/manual/2026-10-15-correo-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51410, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.email_thread_link', N'U') IS NULL OR OBJECT_ID(N'dbo.email_audit', N'U') IS NULL
  THROW 51411, N'Falta la migración 20261015120000_correo_modulo (tablas email_*).', 1;

DECLARE @ProcessName NVARCHAR(255) = N'Solicitudes';
DECLARE @Url         NVARCHAR(255) = N'/process/correo';
DECLARE @Nombre      NVARCHAR(255) = N'Correo';

SELECT DB_NAME() AS base, 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url = @Url;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = @Url)
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@Nombre, @ProcessId, @Url);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url,
       (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc WHERE suc.id_subprocess = s.id_subprocess) AS permisos_otorgados
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @Url;
