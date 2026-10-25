/*
  PASE MANUAL (PRODUCCIÓN) — Módulo «Transferencias Nabuco» (2026-10-25).
  Pedido de Nicolás Rivera: integración SAP → Nabuco WMS configurable desde la app.
  NO lo corre el agente que hizo la rama: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    1. Tabla nabuco_config  — una o varias configuraciones por empresa (contraseña de Nabuco
       CIFRADA con AES-256-GCM, llave en la variable de entorno NABUCO_CONFIG_KEY).
    2. Tabla nabuco_envio   — log de envíos; ÚNICO por (empresa, entidad SAP, DocEntry):
       un documento enviado OK nunca se vuelve a enviar.
    3. Proceso contenedor del menú «Logística» (se busca por nombre; se crea si falta) y dos
       subprocesos-permiso (iguales a lib/transferencias-nabuco/constants.ts):
         /process/transferencias-nabuco        Transferencias Nabuco                    (lectura: tablero y corridas)
         /process/transferencias-nabuco/admin  Transferencias Nabuco · Administración   (configuración y acciones)
    4. Vigilante del programador central (scheduled_job, job_type «nabuco_vigilar», cada 15 min):
       avisa por correo si una configuración activa no corre en N minutos. Las tareas
       «nabuco_transferir» ({ id_config }) NO se siembran aquí: las crea la pantalla al guardar
       cada configuración (cron editable desde la app).
    5. NO otorga permisos a nadie: se asignan en Administración → Usuarios, POR EMPRESA.

  GUARDA: solo KRONOSDB. Respaldo COPY_ONLY antes de correrlo.
  REVERSA: prisma/manual/2026-10-25-transferencias-nabuco-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51701, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

DECLARE @ProcessName NVARCHAR(255) = N'Logística';
DECLARE @Actor       NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) nabuco_config */
  IF OBJECT_ID(N'[dbo].[nabuco_config]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[nabuco_config] (
      [id_config]              INT            IDENTITY(1,1) NOT NULL,
      [id_company]             INT            NOT NULL,
      [nombre]                 NVARCHAR(120)  NOT NULL,
      [activo]                 BIT            NOT NULL CONSTRAINT [nabuco_config_activo_df] DEFAULT 0,
      [modo_simulacion]        BIT            NOT NULL CONSTRAINT [nabuco_config_sim_df] DEFAULT 1,
      [id_sap_endpoint]        INT            NULL,
      [nabuco_url]             NVARCHAR(500)  NULL,
      [nabuco_usuario]         NVARCHAR(200)  NULL,
      [nabuco_password_enc]    NVARCHAR(1000) NULL,
      [nabuco_org]             NVARCHAR(20)   NOT NULL CONSTRAINT [nabuco_config_org_df] DEFAULT N'1',
      [ruta_token]             NVARCHAR(200)  NOT NULL CONSTRAINT [nabuco_config_rtok_df] DEFAULT N'/AuthBI',
      [ruta_solicitudes]       NVARCHAR(200)  NOT NULL CONSTRAINT [nabuco_config_rsol_df] DEFAULT N'/api/NabucoWmsSolicitudesAlistamiento',
      [timeout_ms]             INT            NOT NULL CONSTRAINT [nabuco_config_timeout_df] DEFAULT 30000,
      [entidad_sap]            NVARCHAR(60)   NOT NULL CONSTRAINT [nabuco_config_entidad_df] DEFAULT N'Invoices',
      [filtro_odata]           NVARCHAR(1000) NULL,
      [desde_fecha]            DATE           NULL,
      [lote_max]               INT            NOT NULL CONSTRAINT [nabuco_config_lote_df] DEFAULT 50,
      [marcar_udf]             BIT            NOT NULL CONSTRAINT [nabuco_config_mudf_df] DEFAULT 0,
      [udf_campo]              NVARCHAR(100)  NULL,
      [udf_valor]              NVARCHAR(100)  NULL,
      [clave_lineas]           NVARCHAR(60)   NOT NULL CONSTRAINT [nabuco_config_clin_df] DEFAULT N'items',
      [mapeo_encabezado]       NVARCHAR(MAX)  NOT NULL,
      [mapeo_lineas]           NVARCHAR(MAX)  NOT NULL,
      [max_reintentos]         INT            NOT NULL CONSTRAINT [nabuco_config_mreint_df] DEFAULT 3,
      [espera_reintento_min]   INT            NOT NULL CONSTRAINT [nabuco_config_espera_df] DEFAULT 30,
      [alertas_correos]        NVARCHAR(1000) NULL,
      [alertar_fallo]          BIT            NOT NULL CONSTRAINT [nabuco_config_afallo_df] DEFAULT 1,
      [alertar_sin_correr_min] INT            NULL,
      [ultima_alerta_sin_correr] DATETIME2    NULL,
      [id_job]                 INT            NULL,
      [en_ejecucion_desde]     DATETIME2      NULL,
      [created_by]             NVARCHAR(255)  NOT NULL,
      [created_at]             DATETIME2      NOT NULL CONSTRAINT [nabuco_config_created_df] DEFAULT SYSDATETIME(),
      [updated_by]             NVARCHAR(255)  NULL,
      [updated_at]             DATETIME2      NULL,
      CONSTRAINT [nabuco_config_pkey] PRIMARY KEY CLUSTERED ([id_config]),
      CONSTRAINT [nabuco_config_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company])
    );
    CREATE NONCLUSTERED INDEX [nabuco_config_company_idx] ON [dbo].[nabuco_config]([id_company]);
  END;

  /* 2) nabuco_envio */
  IF OBJECT_ID(N'[dbo].[nabuco_envio]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[nabuco_envio] (
      [id_envio]        BIGINT         IDENTITY(1,1) NOT NULL,
      [id_config]       INT            NOT NULL,
      [id_company]      INT            NOT NULL,
      [entidad]         NVARCHAR(60)   NOT NULL,
      [doc_entry]       INT            NOT NULL,
      [doc_num]         INT            NULL,
      [estado]          NVARCHAR(20)   NOT NULL CONSTRAINT [nabuco_envio_estado_df] DEFAULT N'pendiente',
      [intentos]        INT            NOT NULL CONSTRAINT [nabuco_envio_intentos_df] DEFAULT 0,
      [payload]         NVARCHAR(MAX)  NULL,
      [respuesta]       NVARCHAR(MAX)  NULL,
      [http_status]     INT            NULL,
      [error]           NVARCHAR(2000) NULL,
      [alerta_enviada]  BIT            NOT NULL CONSTRAINT [nabuco_envio_alerta_df] DEFAULT 0,
      [creado]          DATETIME2      NOT NULL CONSTRAINT [nabuco_envio_creado_df] DEFAULT SYSDATETIME(),
      [ultimo_intento]  DATETIME2      NULL,
      [proximo_intento] DATETIME2      NULL,
      [enviado_en]      DATETIME2      NULL,
      [usuario_accion]  NVARCHAR(255)  NULL,
      [fecha_accion]    DATETIME2      NULL,
      CONSTRAINT [nabuco_envio_pkey] PRIMARY KEY CLUSTERED ([id_envio]),
      CONSTRAINT [nabuco_envio_estado_ck] CHECK ([estado] IN (N'pendiente', N'enviado', N'error', N'simulado', N'descartado')),
      CONSTRAINT [nabuco_envio_config_fkey] FOREIGN KEY ([id_config]) REFERENCES [dbo].[nabuco_config]([id_config])
    );
    CREATE UNIQUE NONCLUSTERED INDEX [nabuco_envio_doc_uq] ON [dbo].[nabuco_envio]([id_company], [entidad], [doc_entry]);
    CREATE NONCLUSTERED INDEX [nabuco_envio_config_estado_idx] ON [dbo].[nabuco_envio]([id_config], [estado], [creado]);
  END;

  /* 3) Proceso contenedor y subprocesos (idempotentes por subprocess_url) */
  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  DECLARE @Subs TABLE (subprocess NVARCHAR(255), url NVARCHAR(255));
  INSERT INTO @Subs (subprocess, url) VALUES
    (N'Transferencias Nabuco',                   N'/process/transferencias-nabuco'),
    (N'Transferencias Nabuco · Administración',  N'/process/transferencias-nabuco/admin');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* 4) Vigilante (SQL dinámico: si scheduled_job no existe en la CI, no se compila nada contra ella). */
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
BEGIN
  DECLARE @Next DATETIME = DATEADD(MINUTE, 15, GETDATE());
  EXEC sp_executesql N'IF NOT EXISTS (SELECT 1 FROM [dbo].[scheduled_job] WHERE job_type = N''nabuco_vigilar'')
    INSERT INTO [dbo].[scheduled_job] (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
    VALUES (N''Transferencias Nabuco · vigilante de corridas'', N''nabuco_vigilar'', NULL, N''*/15 * * * *'', @Next, 1, N''transferencias-nabuco'', @Actor, GETDATE());',
    N'@Next DATETIME, @Actor NVARCHAR(255)', @Next = @Next, @Actor = @Actor;
END;

SELECT DB_NAME() AS base, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/transferencias-nabuco%' ORDER BY s.subprocess_url;
