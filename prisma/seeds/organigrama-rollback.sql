/*
  ROLLBACK del módulo Organigrama (SynerLink) — REVERSIÓN de la migración
  20260629000000_add_organigrama_cargos.

  ⚠️ ANTES DE EJECUTAR EN PRODUCCIÓN: tome SIEMPRE un backup completo de la base
     (BACKUP DATABASE) como red de seguridad principal. Este script es el undo
     QUIRÚRGICO de la migración aditiva; el backup cubre todo lo demás.

  Qué hace:
    1. Elimina las 3 tablas NUEVAS que creó la migración, en orden de dependencia
       de llaves foráneas (primero las hijas, luego la padre). Al hacer DROP TABLE,
       SQL Server elimina también las FK e índices propios de esas tablas. NO toca
       la tabla `company` ni ninguna otra estructura existente.
    2. Borra el registro de la migración en `_prisma_migrations` (si existe la
       tabla de historial), para que Prisma no la considere aplicada tras revertir.

  Qué NO cubre este script (revertir aparte si se aplicó el seed de permisos):
    - El seed `organigrama-permisos.sql` inserta filas en tablas EXISTENTES
      (subproceso + permisos para la ruta /process/organigrama). Esas filas NO se
      tocan aquí para no arriesgar estructuras compartidas. Si necesita removerlas,
      identifíquelas por la ruta '/process/organigrama' y bórrelas a mano, o
      restaure desde el backup.

  Idempotente: usa guardas IF OBJECT_ID, se puede correr varias veces sin error.
*/

BEGIN TRY

BEGIN TRAN;

-- 1) Tablas hijas primero (referencian a [cargo])
IF OBJECT_ID('[dbo].[cargo_jerarquia]', 'U') IS NOT NULL
    DROP TABLE [dbo].[cargo_jerarquia];

IF OBJECT_ID('[dbo].[cargo_alias]', 'U') IS NOT NULL
    DROP TABLE [dbo].[cargo_alias];

-- 2) Tabla padre al final
IF OBJECT_ID('[dbo].[cargo]', 'U') IS NOT NULL
    DROP TABLE [dbo].[cargo];

-- 3) Quitar la migración del historial de Prisma (si la tabla existe)
IF OBJECT_ID('[dbo].[_prisma_migrations]', 'U') IS NOT NULL
    DELETE FROM [dbo].[_prisma_migrations]
    WHERE [migration_name] = '20260629000000_add_organigrama_cargos';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
