/*
  REVERSA — Proyectos: mesas de discusión (2026-11-04).
  Borra las tablas de las mesas (y su registro) y devuelve el CHECK de event_type a solo 'nudge'.
  Si hay mesas, exige EXEC sp_set_session_context N'proyectos_mesas_reversa_acepta_perdida', 1.
  Antes de correrla: las conversaciones de las mesas quedan como hilos normales del proyecto;
  los avisos de turno (event_type = 'mesa_turno') se pasan a NULL para que el CHECK viejo entre.
*/
SET XACT_ABORT ON;

-- Hay mesas: se pierden sus reglas, participantes y registro. Exige confirmarlo en la sesión.
IF OBJECT_ID(N'[dbo].[chat_project_mesa]', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM [dbo].[chat_project_mesa])
   AND ISNULL(CAST(SESSION_CONTEXT(N'proyectos_mesas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51582, N'Hay mesas de discusión que se perderían. Respáldelas y declare proyectos_mesas_reversa_acepta_perdida = 1.', 1;

BEGIN TRAN;
UPDATE [dbo].[chat_message] SET [event_type] = NULL WHERE [event_type] = N'mesa_turno';
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_event_type_ck')
  ALTER TABLE [dbo].[chat_message] DROP CONSTRAINT [chat_message_event_type_ck];
EXEC(N'ALTER TABLE [dbo].[chat_message] WITH CHECK ADD CONSTRAINT [chat_message_event_type_ck]
  CHECK ([event_type] IS NULL OR [event_type] IN (''nudge''));');
IF OBJECT_ID(N'[dbo].[TR_chat_project_mesa_evento_inmutable]', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[TR_chat_project_mesa_evento_inmutable];
IF OBJECT_ID(N'[dbo].[chat_project_mesa_evento]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_mesa_evento];
IF OBJECT_ID(N'[dbo].[chat_project_mesa_agente]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_mesa_agente];
IF OBJECT_ID(N'[dbo].[chat_project_mesa]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_project_mesa];
COMMIT TRAN;
