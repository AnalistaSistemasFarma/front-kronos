/*
  PASE DEL SGC A PRODUCCIÓN — PASO 7: RETIRO DEL MÓDULO DOCUMENTAL VIEJO EN KRONOSDB.
  Aprobado por Nicolás Rivera el 2026-09-30 («en producción aún no hay nada
  importante; si hay basura también hay que quitarla»).

  ⚠️ VA DESPUÉS de desplegar el código nuevo (el código viejo de main hace JOIN
  a document_version en «Ver actividades»). Requiere la autorización puntual
  de Nicolás para esta corrida de escritura.

  Qué hace, en una transacción:
    1. Vuelve a comprobar que document, document_type y document_version están
       VACÍAS; si alguna tiene filas, se detiene sin tocar nada.
    2. Respalda en dbo.bk_sgc_pase_* los subprocesos /process/document-
       management*, sus asignaciones y sus notificaciones.
    3. Borra notificaciones, asignaciones y los 2 subprocesos (40 y 41).
    4. DROP de document_version, document y document_type (vacías; mismo
       contenido de la migración 20260930100000_sgc_s0_retiro_gestion_documental,
       que se registra como aplicada en el paso de registro).
  NO toca: document_signatures (Orión), el proceso 52, el tipo de autorización
  «Autorización de documento» ni nada fuera de lo listado.
  Idempotente. Reversa: 01-retiro-modulo-viejo-reversa.sql.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF (OBJECT_ID(N'dbo.document', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.document))
   OR (OBJECT_ID(N'dbo.document_type', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.document_type))
   OR (OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.document_version))
  THROW 50611, N'Candado: alguna tabla del módulo documental viejo YA TIENE FILAS. No se tocó nada; consultar con Nicolás.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.bk_sgc_pase_subprocess', N'U') IS NULL
  BEGIN
    SELECT * INTO dbo.bk_sgc_pase_subprocess FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%';
    SELECT suc.* INTO dbo.bk_sgc_pase_subprocess_user_company FROM dbo.subprocess_user_company suc
      JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url LIKE N'/process/document-management%';
    SELECT * INTO dbo.bk_sgc_pase_notifications FROM dbo.notifications WHERE url LIKE N'/process/document-management%';
  END

  DELETE FROM dbo.notifications WHERE url LIKE N'/process/document-management%';
  DELETE suc FROM dbo.subprocess_user_company suc JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url LIKE N'/process/document-management%';
  DELETE FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%';

  IF OBJECT_ID(N'dbo.document_version', N'U') IS NOT NULL DROP TABLE dbo.document_version;
  IF OBJECT_ID(N'dbo.document_process_subprocess', N'U') IS NOT NULL DROP TABLE dbo.document_process_subprocess;
  IF OBJECT_ID(N'dbo.document_process_category', N'U') IS NOT NULL DROP TABLE dbo.document_process_category;
  IF OBJECT_ID(N'dbo.document', N'U') IS NOT NULL DROP TABLE dbo.document;
  IF OBJECT_ID(N'dbo.document_type', N'U') IS NOT NULL DROP TABLE dbo.document_type;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS q,
  (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (N'document', N'document_type', N'document_version')) AS tablas_viejas,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos_viejos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_subprocess) AS respaldo_subprocesos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_subprocess_user_company) AS respaldo_asignaciones,
  CASE WHEN OBJECT_ID(N'dbo.document_signatures', N'U') IS NOT NULL THEN (SELECT COUNT(*) FROM dbo.document_signatures) END AS document_signatures_intacta;
