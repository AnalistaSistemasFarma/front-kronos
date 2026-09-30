/*
  PASE MANUAL — SGC documental, Sprint 0: retiro de los DATOS del módulo de
  Gestión Documental anterior. Aprobado por Nicolás Rivera el 2026-09-30.

  Sirve igual para KRONOSDB_PRUEBAS y KRONOSDB: identifica todo por NOMBRE y
  URL, nunca por id fijo (en producción no existe el proceso documental; solo
  los subprocesos /process/document-management y .../manage).

  QUÉ RETIRA:
    - El proceso "Gestión Documental — Ciclo de vida del documento" con sus
      tareas, campos genéricos y opciones, y sus solicitudes (tareas de cada
      solicitud, notas del historial, valores del formulario, vínculos).
    - Los subprocesos /process/document-management* y sus asignaciones.
    - Las notificaciones que enlazan a /process/document-management.
  QUÉ NO TOCA (a propósito):
    - El tipo de autorización "Autorización de documento": en KRONOSDB_PRUEBAS
      también lo usa la tarea "Aprobación Financiera" de otro proceso (106).
    - El proceso "Solicitud documental COMEX" (no es de este módulo).
    - El proceso 52 "Autorización Documentos Por Representante Legal".
    - Las tablas document_* (las borra la migración
      20260930100000_sgc_s0_retiro_gestion_documental, que corre DESPUÉS).

  RESPALDO: antes de borrar copia cada fila afectada a tablas
  dbo.bk_20260930_<tabla> (SELECT INTO), incluidas las 5 tablas document_*
  completas. La reversa (prisma/manual/2026-09-30-sgc-s0-retiro-reversa.sql)
  restaura desde ahí. Borrar las bk_20260930_* cuando Nicolás dé por cerrado
  el Sprint 0.

  Candados: si alguna solicitud del proceso tiene datos de Orión o de
  dispersión de pagos, el script se DETIENE sin borrar nada.

  Idempotente: una segunda corrida no encuentra nada que borrar. Imprime el
  conteo antes y después.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @ProcName NVARCHAR(1000) = N'Gestión Documental — Ciclo de vida del documento';
DECLARE @UrlLike  NVARCHAR(100)  = N'/process/document-management%';

DECLARE @P TABLE (id INT PRIMARY KEY);   -- process_category
DECLARE @T TABLE (id INT PRIMARY KEY);   -- task_process_category
DECLARE @F TABLE (id INT PRIMARY KEY);   -- process_form_field
DECLARE @O TABLE (id INT PRIMARY KEY);   -- process_form_field_option
DECLARE @R TABLE (id INT PRIMARY KEY);   -- requests_general
DECLARE @S TABLE (id INT PRIMARY KEY);   -- subprocess

INSERT INTO @P SELECT id FROM dbo.process_category WHERE process = @ProcName;
INSERT INTO @T SELECT id FROM dbo.task_process_category WHERE id_process_category IN (SELECT id FROM @P);
INSERT INTO @F SELECT id FROM dbo.process_form_field WHERE id_process_category IN (SELECT id FROM @P);
INSERT INTO @O SELECT id FROM dbo.process_form_field_option WHERE id_form_field IN (SELECT id FROM @F);
INSERT INTO @R
  SELECT id FROM dbo.requests_general WHERE id_process_category IN (SELECT id FROM @P)
  UNION SELECT id_request_general FROM dbo.process_category_request_general
        WHERE id_process_category IN (SELECT id FROM @P) AND id_request_general IS NOT NULL;
IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL
  INSERT INTO @R
  SELECT DISTINCT dv.id_request_general FROM dbo.document_version dv
  WHERE dv.id_request_general IS NOT NULL AND dv.id_request_general NOT IN (SELECT id FROM @R)
    AND EXISTS (SELECT 1 FROM dbo.requests_general rg WHERE rg.id = dv.id_request_general);
INSERT INTO @S SELECT id_subprocess FROM dbo.subprocess WHERE subprocess_url LIKE @UrlLike;

/* Conteo ANTES */
SELECT 'antes' AS momento, x.tabla, x.filas FROM (
  SELECT 'process_category' tabla, COUNT(*) filas FROM @P
  UNION ALL SELECT 'task_process_category', COUNT(*) FROM @T
  UNION ALL SELECT 'process_form_field', COUNT(*) FROM @F
  UNION ALL SELECT 'process_form_field_option', COUNT(*) FROM @O
  UNION ALL SELECT 'requests_general', COUNT(*) FROM @R
  UNION ALL SELECT 'task_request_general', COUNT(*) FROM dbo.task_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_task IN (SELECT id FROM @T)
  UNION ALL SELECT 'notes', COUNT(*) FROM dbo.notes WHERE id_request IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P)
  UNION ALL SELECT 'request_form_value', COUNT(*) FROM dbo.request_form_value WHERE id_request_general IN (SELECT id FROM @R) OR id_form_field IN (SELECT id FROM @F)
  UNION ALL SELECT 'process_category_request_general', COUNT(*) FROM dbo.process_category_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P)
  UNION ALL SELECT 'user_process_category_request_general', COUNT(*) FROM dbo.user_process_category_request_general WHERE id_process_category IN (SELECT id FROM @P)
  UNION ALL SELECT 'subprocess', COUNT(*) FROM @S
  UNION ALL SELECT 'subprocess_user_company', COUNT(*) FROM dbo.subprocess_user_company WHERE id_subprocess IN (SELECT id FROM @S)
  UNION ALL SELECT 'notifications', COUNT(*) FROM dbo.notifications WHERE url LIKE @UrlLike
) x;

/* Candados: datos de otros módulos colgados de estas solicitudes o subprocesos. */
IF EXISTS (SELECT 1 FROM dbo.orion_document_event WHERE id_request IN (SELECT id FROM @R))
   OR EXISTS (SELECT 1 FROM dbo.orion_document_index WHERE id_request IN (SELECT id FROM @R))
   OR EXISTS (SELECT 1 FROM dbo.payment_run WHERE id_request_general IN (SELECT id FROM @R))
   OR EXISTS (SELECT 1 FROM dbo.agent WHERE id_subprocess IN (SELECT id FROM @S))
   OR EXISTS (SELECT 1 FROM dbo.user_task_request_general WHERE id_task IN (SELECT id FROM @T))
   OR EXISTS (SELECT 1 FROM dbo.task_condition_option WHERE id_task IN (SELECT id FROM @T) OR id_option IN (SELECT id FROM @O))
   OR EXISTS (SELECT 1 FROM dbo.field_condition_option WHERE id_form_field IN (SELECT id FROM @F) OR id_option IN (SELECT id FROM @O))
   OR EXISTS (SELECT 1 FROM dbo.file_condition_option WHERE id_option IN (SELECT id FROM @O))
   OR EXISTS (SELECT 1 FROM dbo.file_process_category WHERE id_process_category IN (SELECT id FROM @P))
   OR EXISTS (SELECT 1 FROM dbo.viewers_process_category WHERE id_process_category IN (SELECT id FROM @P))
   OR EXISTS (SELECT 1 FROM dbo.validators_process_category WHERE id_process_category IN (SELECT id FROM @P))
   OR EXISTS (SELECT 1 FROM dbo.preparers_process_category WHERE id_process_category IN (SELECT id FROM @P))
  THROW 50001, N'Candado: hay datos de otros módulos ligados al módulo documental. Revisar antes de borrar; no se borró nada.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) RESPALDO (solo la primera vez) */
  IF OBJECT_ID(N'dbo.bk_20260930_process_category', N'U') IS NULL
  BEGIN
    SELECT * INTO dbo.bk_20260930_process_category FROM dbo.process_category WHERE id IN (SELECT id FROM @P);
    SELECT * INTO dbo.bk_20260930_task_process_category FROM dbo.task_process_category WHERE id IN (SELECT id FROM @T);
    SELECT * INTO dbo.bk_20260930_process_form_field FROM dbo.process_form_field WHERE id IN (SELECT id FROM @F);
    SELECT * INTO dbo.bk_20260930_process_form_field_option FROM dbo.process_form_field_option WHERE id IN (SELECT id FROM @O);
    SELECT * INTO dbo.bk_20260930_requests_general FROM dbo.requests_general WHERE id IN (SELECT id FROM @R);
    SELECT * INTO dbo.bk_20260930_task_request_general FROM dbo.task_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_task IN (SELECT id FROM @T);
    SELECT * INTO dbo.bk_20260930_notes FROM dbo.notes WHERE id_request IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P);
    SELECT * INTO dbo.bk_20260930_request_form_value FROM dbo.request_form_value WHERE id_request_general IN (SELECT id FROM @R) OR id_form_field IN (SELECT id FROM @F);
    SELECT * INTO dbo.bk_20260930_process_category_request_general FROM dbo.process_category_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P);
    SELECT * INTO dbo.bk_20260930_user_process_category_request_general FROM dbo.user_process_category_request_general WHERE id_process_category IN (SELECT id FROM @P);
    SELECT * INTO dbo.bk_20260930_subprocess FROM dbo.subprocess WHERE id_subprocess IN (SELECT id FROM @S);
    SELECT * INTO dbo.bk_20260930_subprocess_user_company FROM dbo.subprocess_user_company WHERE id_subprocess IN (SELECT id FROM @S);
    SELECT * INTO dbo.bk_20260930_notifications FROM dbo.notifications WHERE url LIKE @UrlLike;
    IF OBJECT_ID(N'dbo.document_type', N'U') IS NOT NULL
      EXEC(N'SELECT * INTO dbo.bk_20260930_document_type FROM dbo.document_type;');
    IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NOT NULL
      EXEC(N'SELECT * INTO dbo.bk_20260930_document_process_category FROM dbo.document_process_category;');
    IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NOT NULL
      EXEC(N'SELECT * INTO dbo.bk_20260930_document_process_subprocess FROM dbo.document_process_subprocess;');
    IF OBJECT_ID(N'dbo.document', N'U') IS NOT NULL
      EXEC(N'SELECT * INTO dbo.bk_20260930_document FROM dbo.document;');
    IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL
      EXEC(N'SELECT * INTO dbo.bk_20260930_document_version FROM dbo.document_version;');
  END

  /* 2) RETIRO — de hijos a padres */
  DELETE FROM dbo.notes WHERE id_request IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P);
  DELETE FROM dbo.request_form_value WHERE id_request_general IN (SELECT id FROM @R) OR id_form_field IN (SELECT id FROM @F);
  DELETE FROM dbo.task_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_task IN (SELECT id FROM @T);
  DELETE FROM dbo.process_category_request_general WHERE id_request_general IN (SELECT id FROM @R) OR id_process_category IN (SELECT id FROM @P);
  IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL
    EXEC(N'UPDATE dbo.document_version SET id_request_general = NULL WHERE id_request_general IS NOT NULL;');
  DELETE FROM dbo.requests_general WHERE id IN (SELECT id FROM @R);
  DELETE FROM dbo.process_form_field_option WHERE id IN (SELECT id FROM @O);
  DELETE FROM dbo.process_form_field WHERE id IN (SELECT id FROM @F);
  DELETE FROM dbo.task_process_category WHERE id IN (SELECT id FROM @T);
  DELETE FROM dbo.user_process_category_request_general WHERE id_process_category IN (SELECT id FROM @P);
  DELETE FROM dbo.process_category WHERE id IN (SELECT id FROM @P);
  DELETE FROM dbo.subprocess_user_company WHERE id_subprocess IN (SELECT id FROM @S);
  DELETE FROM dbo.subprocess WHERE id_subprocess IN (SELECT id FROM @S);
  DELETE FROM dbo.notifications WHERE url LIKE @UrlLike;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Conteo DESPUÉS (todo debe quedar en 0) */
SELECT 'despues' AS momento, x.tabla, x.filas FROM (
  SELECT 'process_category' tabla, COUNT(*) filas FROM dbo.process_category WHERE process = @ProcName
  UNION ALL SELECT 'requests_general', COUNT(*) FROM dbo.requests_general WHERE id IN (SELECT id FROM @R)
  UNION ALL SELECT 'task_request_general', COUNT(*) FROM dbo.task_request_general WHERE id_request_general IN (SELECT id FROM @R)
  UNION ALL SELECT 'notes', COUNT(*) FROM dbo.notes WHERE id_request IN (SELECT id FROM @R)
  UNION ALL SELECT 'subprocess', COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE @UrlLike
  UNION ALL SELECT 'notifications', COUNT(*) FROM dbo.notifications WHERE url LIKE @UrlLike
) x;
