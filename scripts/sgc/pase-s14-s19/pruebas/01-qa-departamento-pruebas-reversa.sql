/*
  SOLO KRONOSDB_PRUEBAS — REVERSA de 01-qa-departamento-pruebas.sql: quita a
  los usuarios QA del SGC del departamento @Departamento.
  ⚠️ Si algún QA ya pertenecía a ese departamento ANTES del script, esta
  reversa también lo quita: revise la salida «antes» que imprimió el script.
  Exige sgc_reversa_qa_departamento = 1 en la sesión.
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51192, N'Este script es SOLO para KRONOSDB_PRUEBAS.', 1;
IF TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_qa_departamento') AS INT) IS NULL
  THROW 51193, N'Declare sgc_reversa_qa_departamento = 1 para confirmar la reversa.', 1;

DECLARE @Departamento NVARCHAR(200) = N'GARANTIA DE CALIDAD';
DECLARE @IdDept INT = (SELECT id_department FROM [dbo].[department] WHERE UPPER([department]) = UPPER(@Departamento));
DELETE du
FROM [dbo].[department_user] du
JOIN [dbo].[user] u ON u.id = du.id_user
WHERE du.id_department = @IdDept
  AND LOWER(u.email) IN (N'qa.sgc@gsslatam.com', N'qa.sgc2@gsslatam.com', N'qa.sgc3@gsslatam.com', N'qa.sgc4@gsslatam.com');
SELECT @@ROWCOUNT AS filas_quitadas;
