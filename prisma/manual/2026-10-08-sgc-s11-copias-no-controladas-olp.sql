/*
  PASE MANUAL — SGC documental, Sprint 11: COPIAS NO CONTROLADAS de One Latam
  Pharma (socialización con Calidad OLP del 2026-10-07).

  PRERREQUISITO: migración 20261008130000_sgc_s11_copias_no_controladas.

  QUÉ HACE (idempotente):
    1. Crea el tipo de autorización SGC-COPIA-NC («Copias no controladas»):
       el GRUPO EXCLUSIVO que decide las copias (Calidad pidió que llegue solo
       a María Camila, nunca al jefe del área).
    2. Si se indica @Integrante (el correo de María Camila u otra persona que
       Calidad designe), lo agrega al grupo con motivo. Si queda vacío, Calidad
       lo agrega desde «Autorizaciones → Tipos de autorización».
    3. Deja la configuración por defecto de la empresa (decisión D5): formatos
       FO y FR, 30 días por defecto y 90 como máximo (ya la pone la migración).
    Todo queda en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.

  REVERSA: la reversa del Sprint 11 desactiva el tipo (no lo borra).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Integrante NVARCHAR(255) = NULL; -- p. ej. N'<correo de María Camila>'
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 11 (socialización con Calidad OLP 2026-10-07): las copias no controladas las decide solo el grupo exclusivo de Calidad (María Camila), nunca el jefe del área.';

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  IF NOT EXISTS (SELECT 1 FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-COPIA-NC')
  BEGIN
    INSERT INTO [sgc].[authorization_type] (id_company, code, name, description, is_active, updated_by, created_at, updated_at)
    VALUES (@IdCompany, N'SGC-COPIA-NC', N'Copias no controladas (Calidad)', N'Grupo exclusivo que autoriza o rechaza las copias no controladas (impresión con marca y vencimiento).', 1, @Actor, @Now, @Now);
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'authorization_type', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), N'autorizacion.tipo_creado', @Motivo, N'{"code":"SGC-COPIA-NC"}');
  END;
  IF @Integrante IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM [sgc].[authorization_type_user] u JOIN [sgc].[authorization_type] t ON t.id_authorization_type = u.id_authorization_type
    WHERE t.id_company = @IdCompany AND t.code = N'SGC-COPIA-NC' AND u.user_email = LOWER(@Integrante) AND u.revoked_at IS NULL)
  BEGIN
    INSERT INTO [sgc].[authorization_type_user] (id_authorization_type, user_email, granted_by, reason, created_at)
    SELECT id_authorization_type, LOWER(@Integrante), @Actor, @Motivo, @Now FROM [sgc].[authorization_type] WHERE id_company = @IdCompany AND code = N'SGC-COPIA-NC';
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'autorizacion.configurada', N'authorization_type_user', N'SGC-COPIA-NC', CONCAT(N'{"email":"', LOWER(@Integrante), N'"}'), @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT t.code, t.name, t.is_active, (SELECT COUNT(*) FROM [sgc].[authorization_type_user] u WHERE u.id_authorization_type = t.id_authorization_type AND u.revoked_at IS NULL) AS integrantes
FROM [sgc].[authorization_type] t WHERE t.id_company = @IdCompany AND t.code = N'SGC-COPIA-NC';
