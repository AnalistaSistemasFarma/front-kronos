/*
  Seed del FLUJO de 14 estados del módulo Gestión Documental (Fase 2).
  SQL Server (provider sqlserver). Idempotente, APPEND-ONLY (no DROP/ALTER/
  TRUNCATE). Mismo espíritu que prisma/seeds/document-management-permisos.sql
  y prisma/seeds/organigrama.mjs: un script que Nicolás corre a mano contra la
  base de pruebas/producción cuando decida activar el módulo; esta Fase 2 NO
  lo aplica por su cuenta.

  Qué hace:
    1. Garantiza UN `process_category` compartido, llamado
       "Gestión Documental — Ciclo de vida del documento", reusando el motor
       de "solicitudes generales" YA existente en la base (tablas SQL crudas
       process_category / task_process_category), NO una tabla nueva.
       Ver lib/document-management/workflowStates.ts para el porqué de que la
       transición entre estados viva en código y no en task_condition_option.
    2. Crea, si faltan, las 14 tareas (una por cada estado LITERAL del ciclo
       de vida) como filas de `task_process_category`, en el mismo orden que
       STATE_DISPLAY_ORDER de workflowStates.ts. Todas quedan `is_sequential = 0`
       a propósito: el avance NO lo decide el motor genérico por
       display_order (ver el porqué en workflowStates.ts), sino
       lib/document-management/workflowEngine.ts. Dejarlas como no
       secuenciales evita que app/api/requests-general/update-activities cree
       "la siguiente tarea por orden" automáticamente si, por lo que sea, este
       proceso llegara a tocarse alguna vez desde la UI genérica de
       solicitudes (no debería, pero es una salvaguarda barata).
    3. Deja el proceso ACTIVO (`active = 1`) para que quede disponible al
       consultarlo por nombre desde workflowEngine.ts.

  Después de correr este script UNA vez por ambiente, workflowEngine.ts
  resuelve los ids reales (proceso + cada tarea, por nombre) en tiempo de
  ejecución y los cachea en memoria del proceso Node; no hace falta anotar
  los ids en ningún .env.
*/

DECLARE @ProcessName NVARCHAR(1000) = N'Gestión Documental — Ciclo de vida del documento';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id FROM [dbo].[process_category] WHERE process = @ProcessName ORDER BY id
);

IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process_category] (process, active, id_status, is_external)
  VALUES (@ProcessName, 1, NULL, 0);
  SET @ProcessId = SCOPE_IDENTITY();
END
ELSE
BEGIN
  -- Ya existía (p.ej. de una corrida anterior parcial): asegurar que quede activo.
  UPDATE [dbo].[process_category] SET active = 1 WHERE id = @ProcessId;
END

-- Tabla de estados + display_order, en el MISMO orden que
-- lib/document-management/workflowStates.ts (STATE_DISPLAY_ORDER). Si ese
-- archivo cambia, actualice también esta lista.
DECLARE @States TABLE (task NVARCHAR(1000), display_order INT);
INSERT INTO @States (task, display_order) VALUES
  (N'En creación', 0),
  (N'En elaboración', 1),
  (N'En revisión', 2),
  (N'En aprobación', 3),
  (N'Aprobado', 4),
  (N'En divulgación', 5),
  (N'Vigente', 6),
  (N'Reasignación', 7),
  (N'Reelaboración', 8),
  (N'Rechazado', 9),
  (N'Obsoleto', 10),
  (N'Anulado', 11),
  (N'Visto bueno calidad', 12),
  (N'Eliminado', 13);

INSERT INTO [dbo].[task_process_category]
  (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
SELECT
  s.task, @ProcessId, 1, 0, NULL, 0, s.display_order, 0, NULL
FROM @States s
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[task_process_category] tpc
  WHERE tpc.id_process_category = @ProcessId AND tpc.task = s.task AND tpc.active = 1
);

/* Diagnóstico: qué quedó sembrado. */
SELECT tpc.id, tpc.task, tpc.display_order, tpc.active
FROM [dbo].[task_process_category] tpc
WHERE tpc.id_process_category = @ProcessId
ORDER BY tpc.display_order;
