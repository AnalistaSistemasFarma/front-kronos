/*
  Migración: chat_agent_quota — MEDIDOR DEL CONSUMO DE ANTHROPIC (2026-10-22).
  Autorización de Nicolás Rivera (2026-10-22, 07:03 COT, «de una»): ver en vivo, en el encabezado de
  TODOS los proyectos, el cupo semanal y la ventana de 5 h del token del agente.

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente. Crea UNA tabla nueva y no altera ni copia
  nada existente:

    - chat_agent_quota  una fila por agente con el ÚLTIMO cupo que reportó su puente de hilos
                        (POST /api/chat/agent/quota): porcentaje y reinicio de cada ventana, estado
                        del excedente, cuándo se midió y de dónde salió ('turno' | 'sonda').

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/consumo-anthropic-sql.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- chat_agent_quota ------------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_agent_quota]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_agent_quota] (
    [id_agent]       INT           NOT NULL,
    [utilization_7d] FLOAT(53)     NULL,
    [reset_7d]       DATETIME2     NULL,
    [utilization_5h] FLOAT(53)     NULL,
    [reset_5h]       DATETIME2     NULL,
    [overage]        NVARCHAR(40)  NULL,
    [measured_at]    DATETIME2     NOT NULL,
    [source]         NVARCHAR(20)  NOT NULL,
    [updated_at]     DATETIME2     NOT NULL,
    CONSTRAINT [chat_agent_quota_pkey] PRIMARY KEY CLUSTERED ([id_agent]),
    CONSTRAINT [chat_agent_quota_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_quota_fuente_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_quota] WITH CHECK ADD CONSTRAINT [chat_agent_quota_fuente_ck] CHECK ([source] IN (N''turno'', N''sonda''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_agent_quota_rango_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_agent_quota] WITH CHECK ADD CONSTRAINT [chat_agent_quota_rango_ck] CHECK (([utilization_7d] IS NULL OR ([utilization_7d] >= 0 AND [utilization_7d] <= 1000)) AND ([utilization_5h] IS NULL OR ([utilization_5h] >= 0 AND [utilization_5h] <= 1000)));');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
