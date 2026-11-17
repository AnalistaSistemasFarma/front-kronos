-- Mesas de discusión: los agentes se pasan archivos (2026-11-11).
-- Nuevo tipo de evento: 'archivo_compartido' (un agente de la mesa compartió un archivo).
-- Solo se reemplaza el CHECK; el trigger de inmutabilidad no cambia.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck'
           AND definition NOT LIKE N'%archivo_compartido%')
  ALTER TABLE [dbo].[chat_project_mesa_evento] DROP CONSTRAINT [chat_project_mesa_evento_tipo_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_mesa_evento_tipo_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_mesa_evento] WITH CHECK ADD CONSTRAINT [chat_project_mesa_evento_tipo_ck]
    CHECK ([tipo] IN (N''creada'', N''turno'', N''respuesta'', N''vencido'', N''tope'', N''pausada'', N''reanudada'',
                      N''cerrada'', N''ronda_ahora'', N''reglas'', N''archivo_compartido''));');
