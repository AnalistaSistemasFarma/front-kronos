/*
  MANUAL STEP (PRUEBAS) — Automation indicator: area (departamento) of 8 more agents (2026-11-23).

  REQUEST (Nicolás Rivera, SynerLink conv 1 msg 37558, 2026-11-23 08:15 COT):
    Sawblaze, Jarvis → INFRAESTRUCTURA · Gilbert → ABASTECIMIENTO Y COMEX · Doki → DIRECCIÓN TÉCNICA
    Luna → CONTABILIDAD · Lisa, Tesa → GERENCIA · Pandora → TALENTO HUMANO

  WHERE THE AREA LIVES: dbo.agent_departamento (created on 2026-11-10 by
  2026-11-10-indicador-departamentos-*.sql); the indicator reads it before the «Casos de uso» value.
  This script creates the table if missing (same DDL) and UPSERTs the rows below. Reads dbo.agent (by code).
  Does NOT touch company_user, subprocess_user_company, user or any login/permission table.
  One batch: XACT_ABORT + LOCK_TIMEOUT 5000 + TRAN. Idempotent. Agents missing in this database
  are reported and skipped (PRUEBAS, 2026-11-23: jarvis does not exist).

  BACKUP: the first result set shows the PREVIOUS area of each agent; keep it in the ACTA.
  REVERSAL: 2026-11-23-indicador-areas-reversa.sql (deletes only these 8 rows; the agent falls
  back to the «Casos de uso» area). It does not drop the table (other agents use it).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51611, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @pedido TABLE (code NVARCHAR(60) PRIMARY KEY, departamento NVARCHAR(120) NOT NULL);
INSERT INTO @pedido (code, departamento) VALUES
  (N'sawblaze', N'INFRAESTRUCTURA'),
  (N'jarvis',   N'INFRAESTRUCTURA'),
  (N'gilbert',  N'ABASTECIMIENTO Y COMEX'),
  (N'doki',     N'DIRECCIÓN TÉCNICA'),
  (N'luna',     N'CONTABILIDAD'),
  (N'lisa',     N'GERENCIA'),
  (N'pandora',  N'TALENTO HUMANO'),
  (N'tesa',     N'GERENCIA');
DECLARE @quien NVARCHAR(200) = N'horus (pedido de Nicolás Rivera 2026-11-23)';
DECLARE @upd INT = 0, @ins INT = 0;

BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.agent_departamento', N'U') IS NULL
    CREATE TABLE [dbo].[agent_departamento] (
      [id_agent]     INT           NOT NULL CONSTRAINT [PK_agent_departamento] PRIMARY KEY,
      [departamento] NVARCHAR(120) NOT NULL,
      [updated_at]   DATETIME2(0)  NOT NULL CONSTRAINT [DF_agent_departamento_updated_at] DEFAULT SYSUTCDATETIME(),
      [updated_by]   NVARCHAR(200) NULL
    );

  -- 1) ANTES (respaldo para el acta).
  SELECT p.code, a.id_agent, a.display_name,
         COALESCE(d.departamento, (SELECT TOP 1 su.departamento FROM dbo.agent_use_summary su
                                    WHERE su.id_agent = a.id_agent ORDER BY su.corte DESC)) AS departamento_anterior,
         CASE WHEN a.id_agent IS NULL THEN N'NO EXISTE EN ESTA BASE (se salta)'
              WHEN d.id_agent IS NULL THEN N'casos de uso' ELSE N'manual' END AS origen_anterior,
         p.departamento AS departamento_nuevo
  FROM @pedido p
  LEFT JOIN dbo.agent a ON a.code = p.code
  LEFT JOIN dbo.agent_departamento d ON d.id_agent = a.id_agent
  ORDER BY p.code;

  -- 2) UPSERT.
  UPDATE d SET d.departamento = p.departamento, d.updated_at = SYSUTCDATETIME(), d.updated_by = @quien
  FROM dbo.agent_departamento d
  JOIN dbo.agent a ON a.id_agent = d.id_agent
  JOIN @pedido p ON p.code = a.code
  WHERE d.departamento <> p.departamento;
  SET @upd = @@ROWCOUNT;

  INSERT INTO dbo.agent_departamento (id_agent, departamento, updated_by)
  SELECT a.id_agent, p.departamento, @quien
  FROM @pedido p
  JOIN dbo.agent a ON a.code = p.code
  WHERE NOT EXISTS (SELECT 1 FROM dbo.agent_departamento d WHERE d.id_agent = a.id_agent);
  SET @ins = @@ROWCOUNT;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

-- 3) DESPUÉS.
SELECT DB_NAME() AS base, @ins AS filas_insertadas, @upd AS filas_actualizadas,
       (SELECT COUNT(*) FROM dbo.agent_departamento) AS filas_en_tabla;
SELECT a.code, a.display_name, d.departamento, d.updated_at
FROM dbo.agent_departamento d JOIN dbo.agent a ON a.id_agent = d.id_agent
ORDER BY d.departamento, a.display_name;
