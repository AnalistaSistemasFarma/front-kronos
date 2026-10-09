/*
  REVERSA de 2026-10-06-avatar-config.sql — retira el avatar estilo Notion.

  Antes de borrar la tabla DEVUELVE a cada persona y a cada agente la imagen que tenía antes
  (previous_image), pero solo si su imagen actual sigue siendo el avatar (/api/avatar/...): si
  alguien ya puso otra foto, esa se respeta. Sin este paso las imágenes apuntarían a una URL que
  responde 404 y la interfaz caería a las iniciales.

  Idempotente. Correr primero en KRONOSDB_PRUEBAS.
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.avatar_config', N'U') IS NOT NULL
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE u SET u.image = c.previous_image
    FROM dbo.[user] u
    JOIN dbo.avatar_config c ON c.owner_type = N'user' AND c.owner_id = u.id
    WHERE u.image LIKE N'/api/avatar/%';

    UPDATE a SET a.avatar_url = c.previous_image
    FROM dbo.agent a
    JOIN dbo.avatar_config c ON c.owner_type = N'agent' AND c.owner_id = CAST(a.id_agent AS NVARCHAR(200))
    WHERE a.avatar_url LIKE N'/api/avatar/%';

    DROP TABLE dbo.avatar_config;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END

SELECT DB_NAME() AS base, 'despues' AS momento, name AS tabla FROM sys.tables WHERE name = 'avatar_config';
