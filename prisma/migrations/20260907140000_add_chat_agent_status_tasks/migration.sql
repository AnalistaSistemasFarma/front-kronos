/*
  Desglose de sub-agentes en curso para el indicador del chat de agentes.

  Pedido de Nicolás (2026-09-07): "si tienes subagentes trabajando también nos
  muestres como si fuera una tablita, como lo hace claude". No cabía en la
  columna `label` (NVarChar(200)), de ahí la columna nueva.

  ESTRICTAMENTE ADITIVA: agrega UNA columna que admite NULL. No toca datos, no
  reescribe la tabla y no cambia ninguna restricción, así que se puede aplicar
  en caliente sin ventana de mantenimiento. Las filas existentes quedan en NULL
  y la interfaz cae al comportamiento de siempre (solo `label`).

  Idempotente: se puede correr dos veces sin romper nada.
*/
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_agent_status]')
    AND name = 'tasks'
)
BEGIN
  ALTER TABLE [dbo].[chat_agent_status] ADD [tasks] NVARCHAR(MAX) NULL;
END
