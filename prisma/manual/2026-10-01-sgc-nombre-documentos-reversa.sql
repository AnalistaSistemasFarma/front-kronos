/*
  REVERSA de prisma/manual/2026-10-01-sgc-nombre-documentos.sql.
  Devuelve los nombres del menú a "Sistema de Gestión de Calidad" (proceso) y
  "SGC documental" (subproceso de entrada). Idempotente. Solo con autorización.
*/

SET XACT_ABORT ON;

DECLARE @Url        NVARCHAR(255) = N'/process/sgc-documental';
DECLARE @OldProcess NVARCHAR(255) = N'Sistema de Gestión de Calidad';
DECLARE @OldSub     NVARCHAR(255) = N'SGC documental';
DECLARE @NewName    NVARCHAR(255) = N'Documentos';

SELECT 'antes' AS momento, p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE subprocess_url = @Url);

  UPDATE [dbo].[process] SET process = @OldProcess
  WHERE id_process = @ProcessId AND process = @NewName;

  UPDATE [dbo].[subprocess] SET subprocess = @OldSub
  WHERE subprocess_url = @Url AND subprocess = @NewName;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, p.id_process, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;
