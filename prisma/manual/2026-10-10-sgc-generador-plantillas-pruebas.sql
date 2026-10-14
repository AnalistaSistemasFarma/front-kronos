/*
  PASE MANUAL (DATOS) — SGC documental: ENCIENDE el Generador de documentos
  desde plantillas aprobadas por Calidad para One Latam Pharma en PRUEBAS
  (decisión de Nicolás Rivera del 2026-10-10).

  PRERREQUISITO: migración 20261010100000_sgc_generador_plantillas.

  QUÉ HACE (idempotente):
    1. Verifica la base: solo KRONOSDB_PRUEBAS (o la CI). En otra base exige
       declarar antes sgc_generador_bd_autorizada = 1 en la sesión.
    2. Pone sgc.company_config.generator_enabled = 1 para @IdCompany (OLP = 3)
       si la empresa está activa en el SGC y el generador estaba apagado.
    3. Deja el cambio en sgc.config_change_log y en sgc.audit_log, con motivo.
  No crea plantillas: las propone gestión documental o Calidad desde la
  pantalla y las aprueba Aseguramiento de Calidad.

  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos"),
  p. ej. node scripts/sgc/pase-produccion/aplicar-sql.mjs desde la carpeta de PRUEBAS.

  REVERSA: prisma/manual/2026-10-10-sgc-generador-plantillas-reversa.sql
  (o, solo apagarlo: UPDATE generator_enabled = 0 con su registro de cambio).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') AND ISNULL(TRY_CAST(SESSION_CONTEXT(N'sgc_generador_bd_autorizada') AS INT), 0) <> 1
  THROW 51106, N'Generador SGC: este script es para KRONOSDB_PRUEBAS. En otra base declare sgc_generador_bd_autorizada = 1 con la autorización del pase.', 1;

IF COL_LENGTH(N'sgc.company_config', N'generator_enabled') IS NULL
  THROW 51107, N'Falta la migración 20261010100000_sgc_generador_plantillas (columna generator_enabled).', 1;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Generador de documentos desde plantillas aprobadas por Calidad (decisión de Nicolás Rivera, 2026-10-10): se enciende en PRUEBAS para la validación con Calidad OLP.';

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany AND is_active = 1)
  BEGIN
    DECLARE @Antes BIT;
    EXEC sp_executesql N'SELECT @a = generator_enabled FROM [sgc].[company_config] WHERE id_company = @c', N'@a BIT OUTPUT, @c INT', @a = @Antes OUTPUT, @c = @IdCompany;
    IF @Antes = 0
    BEGIN
      EXEC sp_executesql N'UPDATE [sgc].[company_config] SET generator_enabled = 1, updated_at = SYSUTCDATETIME() WHERE id_company = @c AND generator_enabled = 0', N'@c INT', @c = @IdCompany;
      INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
      VALUES (@IdCompany, @Now, @Actor, N'company_config', CAST(@IdCompany AS NVARCHAR(60)), N'configuracion.empresa', @Motivo, N'{"generator_enabled":false}', N'{"generator_enabled":true}');
      INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
      VALUES (@IdCompany, @Now, @Actor, N'configuracion.empresa', N'company_config', CAST(@IdCompany AS NVARCHAR(60)), N'{"generator_enabled":false}', N'{"generator_enabled":true}', @Motivo);
    END;
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

EXEC sp_executesql N'SELECT id_company, is_active, generator_enabled FROM [sgc].[company_config] WHERE id_company = @c', N'@c INT', @c = @IdCompany;
