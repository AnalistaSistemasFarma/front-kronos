/* REVERSA — Flujos de trabajo: mejora continua (2026-11-09). Borra las decisiones registradas. */
SET XACT_ABORT ON;
IF ISNULL(CAST(SESSION_CONTEXT(N'flujos_mejora_reversa_acepta_perdida') AS INT), 0) <> 1
   AND EXISTS (SELECT 1 FROM sys.partitions p
               WHERE p.object_id = OBJECT_ID(N'[dbo].[workflow_mejora_decision]', N'U') AND p.index_id IN (0, 1) AND p.rows > 0)
  THROW 51601, N'Hay decisiones de mejora registradas. Respáldelas y declare flujos_mejora_reversa_acepta_perdida = 1.', 1;
IF OBJECT_ID(N'[dbo].[workflow_mejora_decision]', N'U') IS NOT NULL DROP TABLE [dbo].[workflow_mejora_decision];
