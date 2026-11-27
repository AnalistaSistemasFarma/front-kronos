/*
  PASE MANUAL (PROD) — Auditoría de agentes → Adopción de IA vs plantilla (2026-11-26, pedido de Nicolás Rivera).
  QUÉ HACE (idempotente; solo crea lo que falta; tabla nueva, no toca datos existentes):
    - dbo.ai_headcount_snapshot  foto semanal de la plantilla que NO guarda historia en su fuente:
        source 'm365' = personas con licencia de Microsoft 365 por empresa (area = '');
        source 'th'   = «BASE PERSONAL» de Talento Humano por empresa y área (solo conteos, sin nombres ni cédulas).
      La escribe la aplicación (lib/agent-audit/adoption-db.ts): una vez por semana, solo inserta lo que falta.
  Sin modelo Prisma. Riesgo de bloqueo: nulo (solo CREATE TABLE sobre un objeto nuevo).
  VALIDACIÓN: si al final la tabla o su llave no existen, ROLLBACK y THROW. Si cuadra, COMMIT en el MISMO lote.
  REVERSA: 2026-11-26-auditoria-adopcion-ia-reversa.sql
*/
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51761, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[ai_headcount_snapshot]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_headcount_snapshot] (
    [week_start]   DATE           NOT NULL,   -- lunes de la semana
    [source]       NVARCHAR(10)   NOT NULL,   -- m365 | th
    [company_key]  NVARCHAR(40)   NOT NULL,   -- GSS, OLP, FARMALOGICA, RYAN… (lib/agent-audit/adoption-model.ts companyKey)
    [area]         NVARCHAR(120)  NOT NULL CONSTRAINT [DF_aihs_area] DEFAULT (N''),
    [headcount]    INT            NOT NULL,
    [captured_at]  DATETIME2(0)   NOT NULL CONSTRAINT [DF_aihs_cap] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_ai_headcount_snapshot] PRIMARY KEY ([week_start], [source], [company_key], [area]),
    CONSTRAINT [CK_aihs_source] CHECK ([source] IN (N'm365', N'th')),
    CONSTRAINT [CK_aihs_headcount] CHECK ([headcount] >= 0)
  );
END;
IF OBJECT_ID(N'[dbo].[ai_headcount_snapshot]', N'U') IS NULL
   OR NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_ai_headcount_snapshot' AND type = 'PK')
BEGIN
  ROLLBACK;
  THROW 51762, N'Validación fallida: dbo.ai_headcount_snapshot no quedó creada con su llave.', 1;
END;
COMMIT;
SELECT N'ok' AS resultado, COUNT(*) AS filas FROM dbo.ai_headcount_snapshot;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
