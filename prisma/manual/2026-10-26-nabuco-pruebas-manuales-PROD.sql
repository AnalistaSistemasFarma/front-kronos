/*
  PASE MANUAL (PROD) — «Transferencias Nabuco»: pruebas manuales (2026-10-26).
  Pedido de Nicolás Rivera: «una manera en la que podamos hacer pruebas manuales» contra Nabuco
  desde la pantalla (pestaña «Pruebas manuales», solo administradores del módulo).
  NO lo corre el agente que hizo la rama: se corre con el visto bueno de Nicolás.
  Requiere el script 2026-10-25-transferencias-nabuco-PROD.sql (tabla nabuco_config).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    1. Tabla nabuco_prueba_manual — registro de cada «Probar conexión» (tipo 'conexion', sin
       payload) y de cada envío manual (tipo 'envio'). NUNCA guarda token ni contraseña.
       Respuesta recortada a 100 000 caracteres por la app. No toca nabuco_envio: las pruebas
       manuales no afectan la idempotencia del envío automático.
    2. Índice (id_config, creado DESC) para el historial (últimas 20 por configuración).

  GUARDA: solo KRONOSDB. Respaldo COPY_ONLY antes de correrlo.
  REVERSA: prisma/manual/2026-10-26-nabuco-pruebas-manuales-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51711, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

IF OBJECT_ID(N'[dbo].[nabuco_config]', N'U') IS NULL
  THROW 51712, N'Falta la tabla nabuco_config: corra primero el script 2026-10-25-transferencias-nabuco.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'[dbo].[nabuco_prueba_manual]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[nabuco_prueba_manual] (
      [id_prueba]    BIGINT         IDENTITY(1,1) NOT NULL,
      [id_config]    INT            NOT NULL,
      [id_company]   INT            NOT NULL,
      [usuario]      NVARCHAR(255)  NOT NULL,
      [tipo]         NVARCHAR(20)   NOT NULL,
      [doc_entry]    INT            NULL,
      [url]          NVARCHAR(500)  NOT NULL,
      [payload]      NVARCHAR(MAX)  NULL,
      [http_status]  INT            NULL,
      [duracion_ms]  INT            NULL,
      [respuesta]    NVARCHAR(MAX)  NULL,
      [error]        NVARCHAR(2000) NULL,
      [creado]       DATETIME2      NOT NULL CONSTRAINT [nabuco_prueba_manual_creado_df] DEFAULT SYSDATETIME(),
      CONSTRAINT [nabuco_prueba_manual_pkey] PRIMARY KEY CLUSTERED ([id_prueba]),
      CONSTRAINT [nabuco_prueba_manual_tipo_ck] CHECK ([tipo] IN (N'conexion', N'envio')),
      CONSTRAINT [nabuco_prueba_manual_config_fkey] FOREIGN KEY ([id_config]) REFERENCES [dbo].[nabuco_config]([id_config])
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'nabuco_prueba_manual_config_creado_idx' AND object_id = OBJECT_ID(N'[dbo].[nabuco_prueba_manual]'))
    CREATE NONCLUSTERED INDEX [nabuco_prueba_manual_config_creado_idx] ON [dbo].[nabuco_prueba_manual]([id_config], [creado] DESC);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, t.name AS tabla, i.name AS indice
FROM sys.tables t LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.name IS NOT NULL
WHERE t.name = N'nabuco_prueba_manual' ORDER BY i.name;
