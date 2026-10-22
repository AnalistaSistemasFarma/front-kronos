/*
  PASE MANUAL — Bitácora de Proceso: ajustes de la revisión con Farmalógica (2026-10-14).
  Nota: reuniones/2026-10-14-ajustes-bitacora-proceso-farmalogica.md (vault de horus), A5 y A6.

  PRERREQUISITO: prisma/migrations/20261014140000_bitacora_proceso_operadores_areas
  (si falta, el script se detiene sin escribir nada).

  QUÉ HACE (idempotente, en una transacción; Farmalógica id_company = 1):
    1. Área predefinida (A5): «Envase y agrafado» (si no existe).
    2. Actividades nuevas (A6), IDEMPOTENTE POR NOMBRE Y SIN DUPLICAR lo que se creó en vivo:
         Alistamiento inicial            (al inicio, orden 5)
         Despeje de área (fin de lote)   (al final, orden 900)
         Aseo de área                    (al final, orden 910)
       En KRONOSDB_PRUEBAS Nicolás ya creó en la demo «Alistamiento inicial», «Despeje del
       área» y «Aseo del área» (con íconos provisionales y al final del catálogo). Si ya existe
       una actividad con el nombre o con uno de sus ALIAS, NO se inserta otra: solo se le
       corrigen el orden y el ícono (el nombre no se toca, porque los registros guardan copia).
    3. Observación OPCIONAL en todas (Nicolás, 2026-10-14): exige_observacion = 0 en las
       actividades de la empresa (hoy solo «Otra»). La aplicación ya no la aplica; esto deja
       el catálogo coherente con lo que se ve.
    4. OPCIONAL (apagado): «Terminación de lote» ES el cierre, no una actividad (Nicolás,
       2026-10-14). En pruebas existe la actividad «Fin de lote», creada en vivo. Para
       desactivarla, cambie @DesactivarFinDeLote a 1 (no se borra: queda en el historial).
    NO crea usuarios ni otorga permisos. NO crea operarios: el maestro lo llena el
    supervisor desde la pantalla (Catálogo → Operarios) con la lista que envíe Amanda.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
  Por ahora SOLO KRONOSDB_PRUEBAS. CÓMO CORRERLO: script Node con `mssql`
  (memoria "correr-sql-servidores-front-kronos").
  REVERSA: prisma/manual/2026-10-14-bitacora-proceso-ajustes-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51390, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.ot_area', N'U') IS NULL OR OBJECT_ID(N'dbo.ot_operador', N'U') IS NULL
  THROW 51391, N'Falta la migración 20261014140000_bitacora_proceso_operadores_areas.', 1;

DECLARE @IdCompany INT = 1;   -- FARMALOGICA S.A. (mismo id en KRONOSDB y KRONOSDB_PRUEBAS)
DECLARE @Seed NVARCHAR(50) = N'seed-2026-10-14';
DECLARE @DesactivarFinDeLote BIT = 0;   -- 1 = desactivar la actividad «Fin de lote» (ver punto 4)

IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = @IdCompany)
  THROW 51392, N'No existe la empresa Farmalógica (id_company = 1).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, id_actividad, nombre, exige_observacion, orden, activo, icono
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany ORDER BY orden, id_actividad;
SELECT DB_NAME() AS base, 'antes' AS momento, id_area, nombre, activo FROM [dbo].[ot_area] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) Área predefinida (A5). Debe coincidir con OT_AREAS_FARMALOGICA. */
  INSERT INTO [dbo].[ot_area] (id_company, nombre, orden, activo, created_by)
  SELECT @IdCompany, x.nombre, 10, 1, @Seed
  FROM (VALUES (N'Envase y agrafado')) AS x(nombre)
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ot_area] a WHERE a.id_company = @IdCompany AND a.nombre = x.nombre);

  /* 2) Actividades A6. Debe coincidir con OT_ACTIVIDADES_A6. */
  DECLARE @A6 TABLE (canon NVARCHAR(120), icono NVARCHAR(40), orden INT);
  INSERT INTO @A6 (canon, icono, orden) VALUES
    (N'Alistamiento inicial', N'alistamiento', 5),
    (N'Despeje de área (fin de lote)', N'despeje', 900),
    (N'Aseo de área', N'aseo', 910);

  /* Nombres equivalentes ya creados en vivo (incluye el propio nombre canónico). */
  DECLARE @Alias TABLE (canon NVARCHAR(120), alias NVARCHAR(120));
  INSERT INTO @Alias (canon, alias)
  SELECT canon, canon FROM @A6;
  INSERT INTO @Alias (canon, alias) VALUES
    (N'Despeje de área (fin de lote)', N'Despeje del área'),
    (N'Despeje de área (fin de lote)', N'Despeje de área'),
    (N'Aseo de área', N'Aseo del área');

  /* Corrige orden e ícono de las que ya existen (por nombre o alias). */
  UPDATE t SET t.orden = a.orden, t.icono = a.icono
  FROM [dbo].[ot_actividad] t
  JOIN @Alias al ON al.alias = t.nombre
  JOIN @A6 a ON a.canon = al.canon
  WHERE t.id_company = @IdCompany AND (t.orden <> a.orden OR ISNULL(t.icono, N'') <> a.icono);

  /* Inserta solo las que no existen con ningún nombre equivalente. */
  INSERT INTO [dbo].[ot_actividad] (id_company, nombre, exige_observacion, orden, activo, created_by, icono)
  SELECT @IdCompany, a.canon, 0, a.orden, 1, @Seed, a.icono
  FROM @A6 a
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[ot_actividad] t JOIN @Alias al ON al.alias = t.nombre
    WHERE t.id_company = @IdCompany AND al.canon = a.canon
  );

  /* 3) Observación opcional en todas. */
  UPDATE [dbo].[ot_actividad] SET exige_observacion = 0
  WHERE id_company = @IdCompany AND exige_observacion = 1;

  /* 4) Opcional: «Fin de lote» como actividad (la terminación del lote es el cierre). */
  IF @DesactivarFinDeLote = 1
    UPDATE [dbo].[ot_actividad] SET activo = 0
    WHERE id_company = @IdCompany AND nombre = N'Fin de lote' AND activo = 1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, id_actividad, nombre, exige_observacion, orden, activo, icono
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany ORDER BY activo DESC, orden, id_actividad;
SELECT DB_NAME() AS base, 'despues' AS momento, id_area, nombre, orden, activo FROM [dbo].[ot_area] WHERE id_company = @IdCompany;
