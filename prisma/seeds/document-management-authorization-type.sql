/*
  Sprint 6 de Gestión Documental — integración con /process/authorization.

  Crea (si falta) el tipo de autorización "Autorización de documento" en
  `types_authorization` y lo asocia a la tarea "En aprobación" del flujo
  documental (`task_process_category`, ver
  lib/document-management/workflowStates.ts y
  prisma/seeds/document-management-workflow.sql), marcándola con
  `is_authorization = 1` y `type_authorization = <id del tipo nuevo>`.

  Por qué esto basta (no hace falta tabla/endpoint nuevo): el módulo
  /process/authorization YA lista, de forma genérica, cualquier tarea de
  `task_request_general` cuya `task_process_category.is_authorization = 1`
  (ver app/api/authorization/authorization-activities/route.js), filtrada por
  quién tiene ese `type_authorization` asignado en `user_types_authorization`
  (parametrizable por persona desde /process/administration/users, ver
  app/api/users/[id]/authorization-types/route.ts) y que comparta empresa
  (`subprocess_user_company`) y departamento con el solicitante. Al marcar la
  tarea "En aprobación" con esas dos columnas, la tarea que YA se crea al
  llegar un documento a ese estado (lib/document-management/workflowEngine.ts
  ::moveTask) aparece automáticamente en /process/authorization sin crear
  ningún registro adicional.

  La resolución (Autorizar/Rechazar en /process/authorization) sigue pasando
  por el endpoint genérico app/api/requests-general/update-activities, que en
  este sprint se modificó para, ESPECÍFICAMENTE para esta tarea, delegar en
  lib/document-management/workflowEngine.ts::transitionDocumentVersion (ver
  ese archivo) en vez del avance genérico por display_order — así el
  documento sigue el grafo real (aprobada → continúa el flujo; rechazada →
  "Rechazado"), igual que si se hubiera resuelto desde
  /process/document-management/[id].

  SQL Server (provider sqlserver). Idempotente, APPEND-ONLY (no DROP/ALTER/
  TRUNCATE) salvo el UPDATE puntual de las 2 columnas de esta tarea puntual,
  que hoy están en NULL/0 para las 14 tareas (ver seed base). Mismo espíritu
  que prisma/seeds/document-management-workflow.sql: un script que Nicolás
  corre a mano contra la base de pruebas/producción cuando decida activar
  esta integración.

  Requiere haber corrido antes prisma/seeds/document-management-workflow.sql
  (las 14 tareas ya sembradas).
*/

DECLARE @TypeName NVARCHAR(1000) = N'Autorización de documento';

DECLARE @TypeId INT = (
  SELECT TOP 1 id FROM [dbo].[types_authorization] WHERE type_authorization = @TypeName
);

IF @TypeId IS NULL
BEGIN
  INSERT INTO [dbo].[types_authorization] (type_authorization) VALUES (@TypeName);
  SET @TypeId = SCOPE_IDENTITY();
END

DECLARE @ProcessName NVARCHAR(1000) = N'Gestión Documental — Ciclo de vida del documento';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id FROM [dbo].[process_category] WHERE process = @ProcessName AND active = 1
);

IF @ProcessId IS NULL
BEGIN
  RAISERROR(N'El proceso de Gestión Documental no está sembrado todavía. Corra primero prisma/seeds/document-management-workflow.sql.', 16, 1);
  RETURN;
END

UPDATE [dbo].[task_process_category]
SET is_authorization = 1, type_authorization = @TypeId
WHERE id_process_category = @ProcessId AND task = N'En aprobación' AND active = 1;

/* Diagnóstico: qué quedó configurado. */
SELECT tpc.id, tpc.task, tpc.is_authorization, tpc.type_authorization, ta.type_authorization AS type_name
FROM [dbo].[task_process_category] tpc
LEFT JOIN [dbo].[types_authorization] ta ON ta.id = tpc.type_authorization
WHERE tpc.id_process_category = @ProcessId
ORDER BY tpc.display_order;
