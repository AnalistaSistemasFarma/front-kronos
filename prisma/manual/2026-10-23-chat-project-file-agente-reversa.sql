/*
  REVERSA — Archivos del agente en los Archivos del proyecto (2026-10-23). Deshace
  prisma/migrations/20261023150000_chat_project_file_agente y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita chat_project_file.uploaded_by_agent y chat_project_file.id_conversation.
  Los ARCHIVOS no se pierden (siguen en la tabla y en OneDrive); se pierde solo la marca de qué agente
  y en qué conversación los generó. Si hay filas marcadas, se niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'proyectos_archivos_agente_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51563, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @marcados INT = 0;
IF COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_file] WHERE uploaded_by_agent IS NOT NULL OR id_conversation IS NOT NULL', N'@n INT OUTPUT', @n = @marcados OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @marcados AS archivos_del_agente;

IF @marcados > 0
   AND ISNULL(CAST(SESSION_CONTEXT(N'proyectos_archivos_agente_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51564, N'Hay archivos marcados como del agente: use la bandera proyectos_archivos_agente_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') IS NOT NULL
    ALTER TABLE [dbo].[chat_project_file] DROP COLUMN [uploaded_by_agent];
  IF COL_LENGTH(N'dbo.chat_project_file', N'id_conversation') IS NOT NULL
    ALTER TABLE [dbo].[chat_project_file] DROP COLUMN [id_conversation];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') AS uploaded_by_agent,
       COL_LENGTH(N'dbo.chat_project_file', N'id_conversation') AS id_conversation;
