/*
  PASE MANUAL — SGC documental: el módulo se llama «Documentos» en el menú.
  Pedido de Nicolás Rivera el 2026-10-01 (simplificar los textos del módulo).

  ESTADO: preparado, NO ejecutado. Correrlo primero en KRONOSDB_PRUEBAS y
  solo con autorización; en KRONOSDB, únicamente en el pase a producción.

  QUÉ HACE (idempotente, solo UPDATE de dos nombres visibles, sin DROP/ALTER):
    1. El proceso contenedor del menú (tarjeta del hub) pasa de
       "Sistema de Gestión de Calidad" a "Documentos".
    2. El subproceso de entrada (/process/sgc-documental) pasa de
       "SGC documental" a "Documentos".
  Igual para todas las empresas: el proceso y el subproceso son globales; el
  acceso por empresa lo da subprocess_user_company, que no se toca.

  QUÉ NO TOCA: URLs, ids, permisos otorgados ni los subprocesos marcadores de
  permiso (gestion, calidad, flujos), que no salen en el menú.

  OJO al correrlo: los scripts 2026-09-30-sgc-s0-cimientos.sql y su reversa
  buscan el proceso por el nombre viejo. Después de este cambio, si se vuelven
  a correr, hay que poner allí @ProcessName = N'Documentos' (y en
  lib/sgc/constants.ts, SGC_PROCESS_NAME y SGC_SUBPROCESS_NAMES.lectura), o se
  crearía un proceso vacío duplicado.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Imprime el estado antes y después.

  REVERSA: prisma/manual/2026-10-01-sgc-nombre-documentos-reversa.sql
*/

SET XACT_ABORT ON;

DECLARE @Url        NVARCHAR(255) = N'/process/sgc-documental';
DECLARE @OldProcess NVARCHAR(255) = N'Sistema de Gestión de Calidad';
DECLARE @OldSub     NVARCHAR(255) = N'SGC documental';
DECLARE @NewName    NVARCHAR(255) = N'Documentos';

/* Estado ANTES */
SELECT 'antes' AS momento, p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE subprocess_url = @Url);
  IF @ProcessId IS NULL THROW 50001, 'No existe el subproceso /process/sgc-documental.', 1;

  /* El proceso solo se renombra si agrupa únicamente subprocesos del módulo. */
  IF EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE id_process = @ProcessId AND subprocess_url NOT LIKE N'/process/sgc-documental%')
    THROW 50002, 'El proceso contenedor tiene subprocesos de otros módulos; no se renombra.', 1;

  UPDATE [dbo].[process] SET process = @NewName
  WHERE id_process = @ProcessId AND process = @OldProcess;

  UPDATE [dbo].[subprocess] SET subprocess = @NewName
  WHERE subprocess_url = @Url AND subprocess = @OldSub;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;
