/*
  REVERSA — Mesas de discusión: archivos compartidos (2026-11-11).
  Devuelve el CHECK de chat_project_mesa_evento a la lista del 2026-11-04 (sin 'archivo_compartido').
  El registro es INMUTABLE (trigger): los eventos 'archivo_compartido' que ya existan NO se borran.
  Por eso, si hay alguno, el CHECK se crea WITH NOCHECK: protege lo nuevo sin tocar lo ya escrito.
  Sirve en KRONOSDB_PRUEBAS y KRONOSDB. La app tolera la reversa (el evento falla en silencio al log).
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB')
  THROW 51580, N'Base no esperada.', 1;
SET XACT_ABORT ON;
BEGIN TRAN;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck')
  ALTER TABLE [dbo].[chat_project_mesa_evento] DROP CONSTRAINT [chat_project_mesa_evento_tipo_ck];

IF EXISTS (SELECT 1 FROM [dbo].[chat_project_mesa_evento] WHERE [tipo] = N'archivo_compartido')
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa_evento] WITH NOCHECK ADD CONSTRAINT [chat_project_mesa_evento_tipo_ck]
    CHECK ([tipo] IN (N''creada'', N''turno'', N''respuesta'', N''vencido'', N''tope'', N''pausada'', N''reanudada'',
                      N''cerrada'', N''ronda_ahora'', N''reglas''));');
ELSE
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa_evento] WITH CHECK ADD CONSTRAINT [chat_project_mesa_evento_tipo_ck]
    CHECK ([tipo] IN (N''creada'', N''turno'', N''respuesta'', N''vencido'', N''tope'', N''pausada'', N''reanudada'',
                      N''cerrada'', N''ronda_ahora'', N''reglas''));');

COMMIT TRAN;
SELECT name, definition, is_not_trusted FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck';
