/*
  PASE MANUAL (PROD) — Mesas de discusión: los agentes se pasan archivos (2026-11-11).
  Mismo bloque de prisma/migrations/20261111120000_chat_project_mesa_archivo_compartido/migration.sql.
  NO lo corre el agente: se corre con el visto bueno de Nicolás, con respaldo COPY_ONLY antes. Idempotente. REVERSA: 2026-11-11-chat-project-mesa-archivo-compartido-reversa.sql
  Riesgo: bajo. Solo cambia el CHECK de chat_project_mesa_evento (tabla chica, sin tráfico de login);
  LOCK_TIMEOUT 5 s y XACT_ABORT: si hay bloqueo, falla y no deja nada a medias.
  La app tolera que este script no se haya corrido: si el CHECK rechaza el evento, el archivo igual
  queda en el hilo y la falla solo va al log.
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51580, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;
SET XACT_ABORT ON;
BEGIN TRAN;

-- Nuevo tipo de evento: 'archivo_compartido' (un agente de la mesa compartió un archivo).
-- Solo se reemplaza el CHECK; el trigger de inmutabilidad no cambia.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck'
           AND definition NOT LIKE N'%archivo_compartido%')
  ALTER TABLE [dbo].[chat_project_mesa_evento] DROP CONSTRAINT [chat_project_mesa_evento_tipo_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa_evento] WITH CHECK ADD CONSTRAINT [chat_project_mesa_evento_tipo_ck]
    CHECK ([tipo] IN (N''creada'', N''turno'', N''respuesta'', N''vencido'', N''tope'', N''pausada'', N''reanudada'',
                      N''cerrada'', N''ronda_ahora'', N''reglas'', N''archivo_compartido''));');

COMMIT TRAN;
SELECT name, definition FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck';
