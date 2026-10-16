/*
  Siembra: BITÁCORA DE PROCESO — responsables de Farmalógica (2026-10-16). PRODUCCIÓN y PRUEBAS.

  Según la matriz de Amanda Casiano, solo para las personas que YA tienen usuario:
    - Judy Alvarez   (judy.alvarez@farmalogica.com)   → INSPECTOR
    - Karen Blanco   (karen.blanco@farmalogica.com)   → JEFE_PROD
    - Tatiana Rico   (tatiana.rico@farmalogica.com)   → JEFE_PROD
    - Amanda Casiano (amanda.casiano@farmalogica.com) → SUPERVISOR, PROVISIONAL (Nicolás,
      2026-10-16 15:23: «sí, de una, eso es urgente») hasta que los 4 supervisores de la
      matriz tengan usuario; entonces se asignan en Catálogo → Responsables y se desactiva
      a Amanda si corresponde.
  Los otros 4 inspectores y los 4 supervisores aún no tienen cuenta: se asignan desde la app.

  Requiere 20261016180000_bitacora_proceso_responsables.
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI (kronos_ci).
  IDEMPOTENTE (MERGE por empresa + usuario + rol; reactiva si estaba inactivo). Si un correo
  no existe en la base (p. ej. en la CI), lo informa y sigue. Informa antes y después.
  REVERSA de los datos: desactivar las filas desde Catálogo → Responsables.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51430, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.ot_responsable', N'U') IS NULL
  THROW 51431, N'Falta la migración 20261016180000_bitacora_proceso_responsables.', 1;

DECLARE @IdCompany INT          = 1;   -- FARMALOGICA S.A. (mismo id en KRONOSDB y KRONOSDB_PRUEBAS)
DECLARE @Seed      NVARCHAR(50) = N'seed-2026-10-16';

IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = @IdCompany AND company LIKE N'FARMAL%')
  THROW 51432, N'La empresa id_company = 1 no es Farmalógica.', 1;

DECLARE @Asignar TABLE (email NVARCHAR(255) NOT NULL, rol NVARCHAR(20) NOT NULL);
INSERT INTO @Asignar (email, rol) VALUES
  (N'judy.alvarez@farmalogica.com',   N'INSPECTOR'),
  (N'karen.blanco@farmalogica.com',   N'JEFE_PROD'),
  (N'tatiana.rico@farmalogica.com',   N'JEFE_PROD'),
  (N'amanda.casiano@farmalogica.com', N'SUPERVISOR');

SELECT DB_NAME() AS base, 'antes' AS momento, r.rol, u.name, u.email, r.activo
FROM [dbo].[ot_responsable] r LEFT JOIN [dbo].[user] u ON u.id = r.id_user
WHERE r.id_company = @IdCompany ORDER BY r.rol, u.name;

-- Correos que no están como usuario ACTIVO de Farmalógica (no se asignan).
SELECT DB_NAME() AS base, 'omitido' AS momento, a.email, a.rol
FROM @Asignar a
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[user] u JOIN [dbo].[company_user] cu ON cu.id_user = u.id AND cu.id_company = @IdCompany
  WHERE u.email = a.email AND u.isActive = 1);

BEGIN TRAN;
MERGE [dbo].[ot_responsable] AS t
USING (
  SELECT DISTINCT u.id AS id_user, a.rol
  FROM @Asignar a
  JOIN [dbo].[user] u ON u.email = a.email AND u.isActive = 1
  JOIN [dbo].[company_user] cu ON cu.id_user = u.id AND cu.id_company = @IdCompany
) AS s
ON t.id_company = @IdCompany AND t.id_user = s.id_user AND t.rol = s.rol
WHEN MATCHED AND t.activo = 0 THEN
  UPDATE SET activo = 1, updated_by = @Seed, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (id_company, id_user, rol, activo, created_by) VALUES (@IdCompany, s.id_user, s.rol, 1, @Seed);
COMMIT;

-- Después: cada asignación con el permiso que el rol exige (si falta, no sale en el selector).
SELECT DB_NAME() AS base, 'despues' AS momento, r.rol, u.name, u.email, r.activo,
  CASE WHEN EXISTS (SELECT 1 FROM [dbo].[subprocess_user_company] suc JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
                    JOIN [dbo].[subprocess] sp ON sp.id_subprocess = suc.id_subprocess
                    WHERE cu.id_user = r.id_user AND cu.id_company = @IdCompany
                      AND sp.subprocess_url = CASE WHEN r.rol = N'SUPERVISOR' THEN N'/process/bitacora-proceso/gestion' ELSE N'/process/bitacora-proceso' END)
       THEN 1 ELSE 0 END AS tiene_permiso
FROM [dbo].[ot_responsable] r LEFT JOIN [dbo].[user] u ON u.id = r.id_user
WHERE r.id_company = @IdCompany ORDER BY r.rol, u.name;
