/*
  PASE MANUAL — SGC documental, Sprint 12: FIRMANTES SUSTITUTOS de One Latam
  Pharma (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008140000_sgc_s12_aprobadores_sustitutos.

  QUÉ HACE (idempotente):
    1. Crea el tipo de autorización SGC-SUSTITUTOS («Firmantes sustitutos»):
       el GRUPO EXCLUSIVO que asigna un firmante sustituto sobre un cupo
       pendiente cuando el titular está ausente (decisión D8: María Camila y
       un suplente nombrado por Dirección Técnica).
    2. Si se indican @Integrante1 / @Integrante2 (correos de María Camila y de
       su suplente), los agrega al grupo con motivo. Si quedan vacíos, Calidad
       los agrega desde «Autorizaciones → Tipos de autorización».
    NO carga la lista de APROBADORES AUTORIZADOS: la entrega Calidad y la
    registra María Camila en «Aprobadores autorizados» (pantalla del SGC).
    Mientras la lista esté vacía, el servidor no restringe a los aprobadores.
    Todo queda en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.

  REVERSA: la reversa del Sprint 12 desactiva el tipo (no lo borra).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Integrante1 NVARCHAR(255) = NULL; -- p. ej. N'<correo de María Camila>'
DECLARE @Integrante2 NVARCHAR(255) = NULL; -- p. ej. N'<correo del suplente nombrado por Dirección Técnica>'
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 12 (socialización con Calidad OLP 2026-10-07, decisión D8): el firmante sustituto lo asigna solo el grupo exclusivo de Calidad (María Camila y su suplente).';

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-SUSTITUTOS')
  BEGIN
    INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
    VALUES (@IdCompany, N'SGC-SUSTITUTOS', N'Firmantes sustitutos (Calidad)', N'Grupo exclusivo que asigna un firmante sustituto a un cupo pendiente cuando el titular está ausente (con motivo y periodo).', 1, @Actor, @Now, @Now);
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'authorization_type', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), N'autorizacion.tipo_creado', @Motivo, N'{"code":"SGC-SUSTITUTOS"}');
  END;
  DECLARE @Integrantes TABLE (email NVARCHAR(255));
  INSERT INTO @Integrantes SELECT LOWER(LTRIM(RTRIM(e))) FROM (VALUES (@Integrante1), (@Integrante2)) AS x(e) WHERE e IS NOT NULL AND LTRIM(RTRIM(e)) <> N'';
  INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
  SELECT t.id_authorization_type, i.email, @Actor, @Motivo, @Now
  FROM @Integrantes i CROSS JOIN [sgc].[authorization_type] t
  WHERE t.id_company = @IdCompany AND t.code = N'SGC-SUSTITUTOS'
    AND NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.user_email = i.email AND u.revoked_at IS NULL);
  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, @Now, @Actor, N'autorizacion.configurada', N'authorization_type_user', N'SGC-SUSTITUTOS', CONCAT(N'{"email":"', i.email, N'"}'), @Motivo
  FROM @Integrantes i
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[audit_log] a WHERE a.id_company = @IdCompany AND a.entity = N'authorization_type_user' AND a.entity_id = N'SGC-SUSTITUTOS' AND a.after_json = CONCAT(N'{"email":"', i.email, N'"}'));
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT t.code, t.name, t.is_active, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany AND t.code = N'SGC-SUSTITUTOS';
