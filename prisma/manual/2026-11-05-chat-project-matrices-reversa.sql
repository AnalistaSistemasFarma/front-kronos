/*
  REVERSA — Proyectos: matrices integradas (2026-11-05).
  Si hay matrices, exige EXEC sp_set_session_context N'proyectos_matrices_reversa_acepta_perdida', 1.
*/
SET XACT_ABORT ON;
-- (Por sys.partitions y no con SELECT a la tabla: en la segunda corrida la tabla ya no existe.)
IF ISNULL(CAST(SESSION_CONTEXT(N'proyectos_matrices_reversa_acepta_perdida') AS INT), 0) <> 1
   AND EXISTS (SELECT 1 FROM sys.partitions p
               WHERE p.object_id = OBJECT_ID(N'[dbo].[chat_project_matrix]', N'U') AND p.index_id IN (0, 1) AND p.rows > 0)
  THROW 51591, N'Hay matrices que se perderían. Respáldelas y declare proyectos_matrices_reversa_acepta_perdida = 1.', 1;
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[chat_project_matrix_chunk]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_matrix_chunk];
IF OBJECT_ID(N'[dbo].[chat_project_matrix_sheet]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_matrix_sheet];
IF OBJECT_ID(N'[dbo].[chat_project_matrix_version]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_matrix_version];
IF OBJECT_ID(N'[dbo].[chat_project_matrix]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_matrix];
COMMIT TRAN;
