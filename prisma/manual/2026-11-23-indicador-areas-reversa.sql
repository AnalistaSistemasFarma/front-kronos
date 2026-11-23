/* REVERSAL — removes the 8 area rows added on 2026-11-23 (sawblaze, jarvis, gilbert, doki, luna,
   lisa, pandora, tesa) from dbo.agent_departamento. Effect: those agents go back to the area of the
   latest «Casos de uso» cut. Keeps the table and the rows of 2026-11-10. If an agent HAD a manual
   area before (see the ACTA backup), restore it by hand with an UPDATE instead. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS') THROW 51613, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.agent_departamento', N'U') IS NOT NULL
BEGIN
  BEGIN TRAN;
  DELETE d FROM dbo.agent_departamento d JOIN dbo.agent a ON a.id_agent = d.id_agent
  WHERE a.code IN (N'sawblaze', N'jarvis', N'gilbert', N'doki', N'luna', N'lisa', N'pandora', N'tesa');
  SELECT @@ROWCOUNT AS filas_borradas;
  COMMIT TRAN;
END
SELECT DB_NAME() AS base, (SELECT COUNT(*) FROM dbo.agent_departamento) AS filas_en_tabla;
