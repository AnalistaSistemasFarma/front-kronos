/*
  PASE MANUAL (PRUEBAS) — Indicador de automatizaciones: departamento de cada agente (2026-11-10).

  PEDIDO (Nicolás Rivera, 2026-11-10 08:02 COT): renombrar departamentos de los agentes.
    Senhatsumi → INFRAESTRUCTURA · Mechita, Zoe, Orus (horus), Duo → DESARROLLO · Lexa (laura) → JURÍDICO
    Plan → PLANEACIÓN · Nancy (jorge), Cosmo, Pedro, Pedro loro (pedroloro) → GERENCIA
    Kepler → DATA ANALISIS · Lunaris → SEGURIDAD

  DÓNDE VIVÍA EL DEPARTAMENTO: dbo.agent_use_summary.departamento (texto libre por corte de «Casos de
  uso», el más repetido entre los operadores del agente). No hay catálogo con id. Para que la próxima
  carga de Casos de uso no pise el cambio, se guarda aparte en dbo.agent_departamento (NUEVA), que el
  indicador lee primero (lib/agent-audit/automation-db.ts); si un agente no tiene fila, sigue el de
  Casos de uso.

  QUÉ TOCA: crea dbo.agent_departamento si no existe (sin llave foránea, para no tomar bloqueos de
  esquema sobre dbo.agent) y hace UPSERT de las filas de abajo. Solo LEE dbo.agent (por code).
  NO toca company_user, subprocess_user_company, user ni ninguna tabla del login o de permisos.
  Un solo lote: XACT_ABORT + LOCK_TIMEOUT 5000 + TRAN. Idempotente. Si un agente no existe en
  esta base, se informa y se salta (en PROD, al 2026-11-10: pedroloro).

  RESPALDO: la tabla es nueva. El primer resultado muestra el departamento ANTERIOR de cada agente
  (el manual si ya tenía fila; si no, el del último corte de Casos de uso). Guárdelo en el acta.
  REVERSA: prisma/manual/2026-11-10-indicador-departamentos-reversa.sql (DROP de la tabla nueva; el
  indicador vuelve solo al departamento de Casos de uso). El código tolera que la tabla no exista.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51611, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @pedido TABLE (code NVARCHAR(60) PRIMARY KEY, departamento NVARCHAR(120) NOT NULL);
INSERT INTO @pedido (code, departamento) VALUES
  (N'senhatsumi', N'INFRAESTRUCTURA'),
  (N'mechita',    N'DESARROLLO'),
  (N'zoe',        N'DESARROLLO'),
  (N'horus',      N'DESARROLLO'),
  (N'duo',        N'DESARROLLO'),
  (N'laura',      N'JURÍDICO'),
  (N'plan',       N'PLANEACIÓN'),
  (N'jorge',      N'GERENCIA'),
  (N'cosmo',      N'GERENCIA'),
  (N'pedro',      N'GERENCIA'),
  (N'pedroloro',  N'GERENCIA'),
  (N'kepler',     N'DATA ANALISIS'),
  (N'lunaris',    N'SEGURIDAD');
DECLARE @quien NVARCHAR(200) = N'horus (pedido de Nicolás Rivera 2026-11-10)';
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
