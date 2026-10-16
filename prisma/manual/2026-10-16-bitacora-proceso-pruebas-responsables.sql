/*
  SOLO PRUEBAS — BITÁCORA DE PROCESO: Nicolás Rivera como SUPERVISOR de Farmalógica (2026-10-16).

  En pruebas, además de la siembra general (Amanda supervisora provisional, Judy inspectora,
  Karen y Tatiana jefes), Nicolás (Gestión) actúa como supervisor para poder probar el cierre.
  En PRODUCCIÓN NO se corre.

  Requiere 20261016180000_bitacora_proceso_responsables.
  GUARDA: solo KRONOSDB_PRUEBAS o la base efímera de la CI (kronos_ci). NUNCA producción.
  Idempotente. Informa antes y después.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51440, N'Base no esperada: este script es SOLO para KRONOSDB_PRUEBAS (o kronos_ci).', 1;
IF OBJECT_ID(N'dbo.ot_responsable', N'U') IS NULL
  THROW 51441, N'Falta la migración 20261016180000_bitacora_proceso_responsables.', 1;

DECLARE @IdCompany INT          = 1;   -- FARMALOGICA S.A.
DECLARE @Seed      NVARCHAR(50) = N'seed-2026-10-16-pruebas';
DECLARE @IdUser    NVARCHAR(50) = (
  SELECT TOP 1 u.id FROM [dbo].[user] u JOIN [dbo].[company_user] cu ON cu.id_user = u.id AND cu.id_company = @IdCompany
  WHERE u.email = N'nicolas.rivera@gsslatam.com' AND u.isActive = 1);

SELECT DB_NAME() AS base, 'antes' AS momento, rol, activo FROM [dbo].[ot_responsable]
WHERE id_company = @IdCompany AND id_user = @IdUser;

IF @IdUser IS NULL
  SELECT DB_NAME() AS base, 'omitido' AS momento, N'nicolas.rivera@gsslatam.com' AS email;
ELSE IF EXISTS (SELECT 1 FROM [dbo].[ot_responsable] WHERE id_company = @IdCompany AND id_user = @IdUser AND rol = N'SUPERVISOR')
  UPDATE [dbo].[ot_responsable] SET activo = 1, updated_by = @Seed, updated_at = SYSUTCDATETIME()
  WHERE id_company = @IdCompany AND id_user = @IdUser AND rol = N'SUPERVISOR' AND activo = 0;
ELSE
  INSERT INTO [dbo].[ot_responsable] (id_company, id_user, rol, activo, created_by) VALUES (@IdCompany, @IdUser, N'SUPERVISOR', 1, @Seed);

SELECT DB_NAME() AS base, 'despues' AS momento, rol, activo FROM [dbo].[ot_responsable]
WHERE id_company = @IdCompany AND id_user = @IdUser;
