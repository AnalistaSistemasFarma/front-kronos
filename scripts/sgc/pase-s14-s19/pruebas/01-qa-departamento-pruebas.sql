/*
  SOLO KRONOSDB_PRUEBAS — S15 (DOC v7, R40): los usuarios QA del SGC
  (qa.sgc, qa.sgc2, qa.sgc3 y qa.sgc4) comparten DEPARTAMENTO en SynerLink.

  Por qué: con el DOC v7 quien pide elabora y sus revisores y aprobadores son
  de SU departamento (dbo.department_user). La e2e del SGC usa a qa.sgc como
  elaborador y a qa.sgc2/qa.sgc3 como revisores y aprobadores: sin un
  departamento común, el servidor los rechaza (como debe).

  Qué hace (idempotente): agrega a cada usuario QA al departamento
  @Departamento si aún no está en él. No quita ningún otro departamento.
  Se niega a correr fuera de KRONOSDB_PRUEBAS. Imprime antes y después.

  REVERSA: 01-qa-departamento-pruebas-reversa.sql (quita SOLO esas filas).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51190, N'Este script es SOLO para KRONOSDB_PRUEBAS.', 1;

DECLARE @Departamento NVARCHAR(200) = N'GARANTIA DE CALIDAD';
DECLARE @Qa TABLE (email NVARCHAR(255) PRIMARY KEY);
INSERT INTO @Qa (email) VALUES (N'qa.sgc@gsslatam.com'), (N'qa.sgc2@gsslatam.com'), (N'qa.sgc3@gsslatam.com'), (N'qa.sgc4@gsslatam.com');

DECLARE @IdDept INT = (SELECT id_department FROM [dbo].[department] WHERE UPPER([department]) = UPPER(@Departamento));
IF @IdDept IS NULL
BEGIN
  SELECT id_department, department FROM [dbo].[department] ORDER BY department;
  THROW 51191, N'El departamento no existe en PRUEBAS: ajuste @Departamento con uno de la lista.', 1;
END;

SELECT 'antes' AS momento, u.email, d.department
FROM @Qa q JOIN [dbo].[user] u ON LOWER(u.email) = q.email
LEFT JOIN [dbo].[department_user] du ON du.id_user = u.id
LEFT JOIN [dbo].[department] d ON d.id_department = du.id_department
ORDER BY u.email;

INSERT INTO [dbo].[department_user] (id_user, id_department)
SELECT u.id, @IdDept
FROM @Qa q JOIN [dbo].[user] u ON LOWER(u.email) = q.email
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[department_user] du WHERE du.id_user = u.id AND du.id_department = @IdDept);

SELECT 'despues' AS momento, u.email, d.department
FROM @Qa q JOIN [dbo].[user] u ON LOWER(u.email) = q.email
LEFT JOIN [dbo].[department_user] du ON du.id_user = u.id
LEFT JOIN [dbo].[department] d ON d.id_department = du.id_department
ORDER BY u.email;
