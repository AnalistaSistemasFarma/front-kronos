/*
  SOLO PRUEBAS — Bitácora de Proceso: segundo usuario QA como INSPECTOR para la demostración.
  El inspector debe ser una persona distinta del supervisor (qa.sgc), por eso se usa qa.sgc2.

  QUÉ HACE (idempotente, solo inserción):
    1. Vincula qa.sgc2@gsslatam.com a FARMALOGICA S.A. (company_user, id_company = 1) si no lo está.
    2. Le otorga en Farmalógica SOLO el subproceso base /process/bitacora-proceso
       (participante: registra y verifica como inspector; NO Gestión).

  GUARDA: solo KRONOSDB_PRUEBAS. NUNCA en producción.
  REVERSA: borrar esa fila de subprocess_user_company (y el company_user si se creó aquí).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51370, N'Este script solo corre en KRONOSDB_PRUEBAS.', 1;

DECLARE @Email     NVARCHAR(255)  = N'qa.sgc2@gsslatam.com';
DECLARE @IdCompany INT            = 1;
DECLARE @IdUser    NVARCHAR(1000) = (SELECT id FROM [dbo].[user] WHERE email = @Email);
IF @IdUser IS NULL THROW 51371, N'No existe el usuario QA 2.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[company_user] WHERE id_user = @IdUser AND id_company = @IdCompany)
    INSERT INTO [dbo].[company_user] (id_company, id_user) VALUES (@IdCompany, @IdUser);

  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT s.id_subprocess, cu.id_company_user
  FROM [dbo].[subprocess] s
  JOIN [dbo].[company_user] cu ON cu.id_user = @IdUser AND cu.id_company = @IdCompany
  WHERE s.subprocess_url = N'/process/bitacora-proceso'
    AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess_user_company] x
                    WHERE x.id_subprocess = s.id_subprocess AND x.id_company_user = cu.id_company_user);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, u.email, c.company, cu.id_company_user, s.id_subprocess, s.subprocess_url, suc.id_subprocess_user_company
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url LIKE N'/process/bitacora-proceso%' ORDER BY u.email, s.subprocess_url;
