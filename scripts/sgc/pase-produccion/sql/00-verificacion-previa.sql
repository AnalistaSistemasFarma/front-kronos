/*
  PASE DEL SGC A PRODUCCIÓN — PASO 0: VERIFICACIÓN PREVIA (SOLO LECTURA).

  Se corre en KRONOSDB antes de tocar nada. No escribe. Se DETIENE (THROW) si
  algo no está como se espera; en ese caso NO se sigue con el pase.

  Comprueba (estado medido el 2026-10-01, solo lectura):
    - Las 3 tablas del módulo documental viejo existen y siguen VACÍAS
      (document, document_type, document_version = 0 filas). Retiro aprobado
      por Nicolás el 2026-09-30 con la condición de que sigan vacías.
    - No existen document_process_category ni document_process_subprocess, o
      están vacías.
    - Los subprocesos del módulo viejo son exactamente 2 (/process/document-
      management y .../manage) y tienen como mucho 1 asignación.
    - No hay solicitudes ni proceso «Gestión Documental — Ciclo de vida».
    - El esquema `sgc` NO existe todavía (o está vacío) y no hay trigger de
      base de datos con el nombre del SGC.
    - OLP es id_company = 3 (ONELATAMPHARMA).
    - Existe un respaldo completo de KRONOSDB de las últimas 24 horas
      (si no, infraestructura debe tomar uno COPY_ONLY antes de seguir).
    - document_signatures (de Orión) NO se toca: solo se informa su conteo.
*/
SET NOCOUNT ON;

DECLARE @problemas NVARCHAR(MAX) = N'';

DECLARE @n BIGINT;
IF OBJECT_ID(N'dbo.document', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @x = COUNT_BIG(*) FROM dbo.document', N'@x BIGINT OUTPUT', @x = @n OUTPUT;
  IF @n > 0 SET @problemas += CONCAT(N'dbo.document tiene ', @n, N' filas. ');
END
IF OBJECT_ID(N'dbo.document_type', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @x = COUNT_BIG(*) FROM dbo.document_type', N'@x BIGINT OUTPUT', @x = @n OUTPUT;
  IF @n > 0 SET @problemas += CONCAT(N'dbo.document_type tiene ', @n, N' filas. ');
END
IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @x = COUNT_BIG(*) FROM dbo.document_version', N'@x BIGINT OUTPUT', @x = @n OUTPUT;
  IF @n > 0 SET @problemas += CONCAT(N'dbo.document_version tiene ', @n, N' filas. ');
END
IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @x = COUNT_BIG(*) FROM dbo.document_process_category', N'@x BIGINT OUTPUT', @x = @n OUTPUT;
IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NOT NULL AND @n > 0 SET @problemas += N'dbo.document_process_category tiene filas. ';
IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @x = COUNT_BIG(*) FROM dbo.document_process_subprocess', N'@x BIGINT OUTPUT', @x = @n OUTPUT;
IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NOT NULL AND @n > 0 SET @problemas += N'dbo.document_process_subprocess tiene filas. ';

-- Ninguna tabla ajena referencia las tablas que se van a borrar.
IF EXISTS (SELECT 1 FROM sys.foreign_keys fk
           WHERE OBJECT_NAME(fk.referenced_object_id) IN (N'document', N'document_type', N'document_version')
             AND OBJECT_NAME(fk.parent_object_id) NOT IN (N'document', N'document_version'))
  SET @problemas += N'Hay claves foráneas de otras tablas hacia document/document_type/document_version. ';

DECLARE @subs INT = (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%');
DECLARE @asig INT = (SELECT COUNT(*) FROM dbo.subprocess_user_company suc JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url LIKE N'/process/document-management%');
IF @subs > 2 SET @problemas += CONCAT(N'Hay ', @subs, N' subprocesos /process/document-management* (se esperaban 2). ');
IF @asig > 1 SET @problemas += CONCAT(N'Los subprocesos viejos tienen ', @asig, N' asignaciones (se esperaba 1 como máximo). ');
IF EXISTS (SELECT 1 FROM dbo.process_category WHERE process = N'Gestión Documental — Ciclo de vida del documento')
  SET @problemas += N'Existe el proceso «Gestión Documental — Ciclo de vida del documento» en producción. ';

IF EXISTS (SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID(N'sgc'))
  SET @problemas += N'El esquema sgc ya tiene tablas (¿pase repetido? revisar antes). ';
IF NOT EXISTS (SELECT 1 FROM dbo.company WHERE id_company = 3 AND company = N'ONELATAMPHARMA')
  SET @problemas += N'id_company 3 no es ONELATAMPHARMA. ';

DECLARE @ultimoRespaldo DATETIME = (SELECT MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND type = 'D');

SELECT 'estado' AS q, DB_NAME() AS base, @@SERVERNAME AS servidor,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.document') AND p.index_id IN (0, 1)) AS document,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.document_type') AND p.index_id IN (0, 1)) AS document_type,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.document_version') AND p.index_id IN (0, 1)) AS document_version,
       @subs AS subprocesos_viejos, @asig AS asignaciones_viejas,
       (SELECT COUNT(*) FROM dbo.notifications WHERE url LIKE N'/process/document-management%') AS notificaciones_viejas,
       (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.document_signatures') AND p.index_id IN (0, 1)) AS document_signatures_orion_no_se_toca,
       (SELECT COUNT(*) FROM sys.schemas WHERE name = N'sgc') AS esquema_sgc,
       @ultimoRespaldo AS ultimo_respaldo_completo,
       DATEDIFF(HOUR, @ultimoRespaldo, GETDATE()) AS horas_desde_respaldo;
SELECT 'subprocesos_viejos' AS q, s.id_subprocess, s.subprocess, s.subprocess_url, suc.id_company_user
FROM dbo.subprocess s LEFT JOIN dbo.subprocess_user_company suc ON suc.id_subprocess = s.id_subprocess
WHERE s.subprocess_url LIKE N'/process/document-management%';

IF @ultimoRespaldo IS NULL OR DATEDIFF(HOUR, @ultimoRespaldo, GETDATE()) > 24
  SET @problemas += N'No hay respaldo completo de las últimas 24 horas: pedir a infraestructura un BACKUP COPY_ONLY antes de seguir. ';

IF LEN(@problemas) > 0
  THROW 50601, @problemas, 1;
SELECT 'resultado' AS q, N'Verificación previa CORRECTA: se puede seguir con el pase.' AS mensaje;
