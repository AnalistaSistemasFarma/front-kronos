/*
  PASE MANUAL (PROD) — Permisos API: nivel de acceso (solo lectura / lectura y escritura). 2026-11-11.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente):
    1. dbo.api_client.access_mode NVARCHAR(20) NULL, CHECK api_client_access_mode_ck (NULL, N'lectura', N'escritura').
         NULL o 'lectura' = el cliente de API solo consulta. 'escritura' = también puede usar los permisos
         que escriben (crear solicitudes, notas, adjuntos, propuestas…). Lo pone SynerLink: Permisos API →
         cliente → «Permitir escritura». Aplica a agentes, México, proveedores o clientes y otros.
    2. dbo.api_permission.access_kind NVARCHAR(20) NOT NULL DEFAULT N'consulta', CHECK (N'consulta', N'escritura'),
         y marca como 'escritura' los permisos que escriben (misma lista que TOOL_CAPABILITIES.write del MCP).
    3. Para no cortar a nadie: los clientes que YA tienen algún permiso de escritura quedan en 'escritura';
         los demás quedan en NULL (= solo lectura).
    4. Si existe la columna portal_mode (prueba descartada del 2026-11-11, solo pudo existir en PRUEBAS)
         la quita junto con su CHECK.

  OBLIGATORIO antes de desplegar el código de Permisos API del 2026-11-11 (Kronos y MCP): leen estas
  columnas con nombre y, si faltan, el panel muestra «Falta aplicar … nivel de acceso» y el MCP no carga
  las llaves de la base (falla cerrado).
  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: SSMS (F5). SOLO en la ventana autorizada del pase, después de validarlo en PRUEBAS.
  REVERSA: prisma/manual/2026-11-11-permisos-api-nivel-acceso-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51773, N'Base no esperada: este script es solo para KRONOSDB.', 1;

IF OBJECT_ID(N'dbo.api_client', N'U') IS NULL OR OBJECT_ID(N'dbo.api_permission', N'U') IS NULL
  THROW 51774, N'No existen las tablas de Permisos API: primero el script 2026-11-09-permisos-api.', 1;

BEGIN TRANSACTION;

/* 4. Prueba descartada «modo del portal» */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'api_client_portal_mode_ck' AND parent_object_id = OBJECT_ID(N'dbo.api_client'))
  ALTER TABLE [dbo].[api_client] DROP CONSTRAINT [api_client_portal_mode_ck];
IF COL_LENGTH(N'dbo.api_client', N'portal_mode') IS NOT NULL
  ALTER TABLE [dbo].[api_client] DROP COLUMN [portal_mode];

/* 1. Nivel de acceso del cliente */
IF COL_LENGTH(N'dbo.api_client', N'access_mode') IS NULL
  ALTER TABLE [dbo].[api_client] ADD [access_mode] NVARCHAR(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'api_client_access_mode_ck' AND parent_object_id = OBJECT_ID(N'dbo.api_client'))
  EXEC(N'ALTER TABLE [dbo].[api_client] ADD CONSTRAINT [api_client_access_mode_ck] CHECK ([access_mode] IS NULL OR [access_mode] IN (N''lectura'', N''escritura''))');

/* 2. Tipo de cada permiso */
IF COL_LENGTH(N'dbo.api_permission', N'access_kind') IS NULL
  ALTER TABLE [dbo].[api_permission] ADD [access_kind] NVARCHAR(20) NOT NULL
    CONSTRAINT [api_permission_access_kind_df] DEFAULT N'consulta' WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'api_permission_access_kind_ck' AND parent_object_id = OBJECT_ID(N'dbo.api_permission'))
  EXEC(N'ALTER TABLE [dbo].[api_permission] ADD CONSTRAINT [api_permission_access_kind_ck] CHECK ([access_kind] IN (N''consulta'', N''escritura''))');

-- EXEC: las columnas recién creadas no existen cuando SQL Server compila el lote.
EXEC(N'UPDATE [dbo].[api_permission] SET [access_kind] = N''escritura''
       WHERE [code] IN (N''kronos_create_request'', N''kronos_add_note'', N''kronos_resolve_task'', N''kronos_set_request_fields'', N''kronos_categorize_request'', N''kronos_upload_attachment'', N''kronos_delete_attachment'', N''kronos_categorize_case'', N''kronos_request_ia_access'', N''correo_proponer_respuesta'', N''correo_crear_solicitud_desde_hilo'', N''correo_agregar_nota'', N''proyecto_proponer_tarea'', N''proyecto_proponer_cambio_tarea'', N''proyecto_proponer_vincular_solicitud'', N''proyecto_proponer_desvincular_solicitud'', N''proyecto_proponer_conversacion'', N''proyecto_proponer_invitar'', N''kronos_usuarios_crear'') AND [access_kind] <> N''escritura''');

/* 3. Los clientes que ya escriben siguen escribiendo */
EXEC(N'UPDATE c SET c.[access_mode] = N''escritura''
        FROM [dbo].[api_client] c
       WHERE c.[access_mode] IS NULL
         AND EXISTS (SELECT 1 FROM [dbo].[api_client_permission] cp
                       INNER JOIN [dbo].[api_permission] p ON p.[code] = cp.[permission_code]
                      WHERE cp.[id_api_client] = c.[id_api_client] AND p.[access_kind] = N''escritura'')');

COMMIT TRANSACTION;

/* Diagnóstico */
EXEC(N'SELECT DB_NAME() AS base,
       COL_LENGTH(N''dbo.api_client'', N''access_mode'') AS access_mode_bytes,
       COL_LENGTH(N''dbo.api_permission'', N''access_kind'') AS access_kind_bytes,
       COL_LENGTH(N''dbo.api_client'', N''portal_mode'') AS portal_mode_bytes,
       (SELECT COUNT(*) FROM [dbo].[api_permission] WHERE [access_kind] = N''escritura'') AS permisos_escritura,
       (SELECT COUNT(*) FROM [dbo].[api_client] WHERE [access_mode] = N''escritura'') AS clientes_escritura,
       (SELECT COUNT(*) FROM [dbo].[api_client]) AS clientes');
