/*
  PASE MANUAL — Avatar estilo Notion (Perfil de la persona y avatar de los asistentes del chat).

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.avatar_config  la CONFIGURACIÓN del avatar (opciones de DiceBear 10/Lorelei en JSON, ~340 caracteres)
                         de una persona (owner_type = 'user', owner_id = user.id) o de un agente
                         (owner_type = 'agent', owner_id = agent.id_agent como texto).
                         previous_image guarda la foto que había ANTES del primer avatar, para que
                         "Quitar avatar" la devuelva tal cual.

  La imagen NO se guarda: GET /api/avatar/user/<id> y /api/avatar/agent/<code> la generan en SVG
  con DiceBear 10 (new Avatar(lorelei, opciones)).
  Al guardar, la aplicación apunta dbo.[user].image / dbo.agent.avatar_url a esa URL (columnas que
  ya existen); por eso NO hay cambio de schema.prisma ni `prisma generate` en el pase.

  Sin modelo Prisma (lib/avatar/store.ts usa withMssqlPool): si el código sale ANTES que este
  script, nada se cae — el Perfil muestra "aún no está habilitado" y no deja guardar.

  Sin llaves foráneas, a propósito: owner_id apunta a dos tablas distintas según owner_type.
  Una fila huérfana (persona o agente borrado) no se muestra en ninguna parte.

  VOLUMEN ESPERADO: una fila por persona o agente que configure su avatar (cientos, como mucho).

  CÓMO CORRERLO: SOLO en KRONOSDB_PRUEBAS. En KRONOSDB (producción) únicamente con autorización
  expresa del pase. Es idempotente. Reversa: 2026-10-06-avatar-config-reversa.sql
*/

SET XACT_ABORT ON;

SELECT DB_NAME() AS base, 'antes' AS momento, name AS tabla FROM sys.tables WHERE name = 'avatar_config';

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.avatar_config', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.avatar_config (
      owner_type      NVARCHAR(10)    NOT NULL,           -- 'user' | 'agent'
      owner_id        NVARCHAR(200)   NOT NULL,           -- user.id (cuid) o agent.id_agent
      config_json     NVARCHAR(1000)  NOT NULL,           -- {"v":3,"estilo":"lorelei","seed":"…","hair":"variant25",…}
      previous_image  NVARCHAR(1000)  NULL,               -- foto anterior, para "Quitar avatar"
      updated_by      NVARCHAR(255)   NULL,               -- correo de quien hizo el último cambio
      updated_at      DATETIME2(3)    NOT NULL CONSTRAINT DF_avatar_config_updated_at DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_avatar_config PRIMARY KEY CLUSTERED (owner_type, owner_id),
      CONSTRAINT CK_avatar_config_owner_type CHECK (owner_type IN (N'user', N'agent'))
    );
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, name AS tabla FROM sys.tables WHERE name = 'avatar_config';
