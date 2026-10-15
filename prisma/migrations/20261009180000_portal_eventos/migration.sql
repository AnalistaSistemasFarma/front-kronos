/*
  Migración: PORTAL TH — EVENTOS DE LA EMPRESA en el calendario de la ventana principal — ADITIVA.

  Pedido de Cristian Baldión (2026-10-09): un calendario de Colombia con festivos y fechas importantes, y debajo
  los eventos importantes de cada día. Festivos y fechas importantes se calculan en código; esta tabla guarda
  SOLO los eventos de la empresa que carguen los editores del portal.

  1. `portal_evento`  un evento = un día (fecha, título, descripción opcional); borrado lógico.

  No toca ninguna tabla existente. Generada MANUALMENTE (sin shadow database — P3014, igual que las migraciones
  anteriores del portal). Correr primero contra KRONOSDB_PRUEBAS (.230), ANTES del despliegue del código.
  Idempotente: se puede correr dos veces. La REVERSA está al final de este archivo (y en prisma/manual/).
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_evento' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_evento] (
    [id]           INT IDENTITY(1,1) NOT NULL,
    [fecha]        DATE           NOT NULL,
    [titulo]       NVARCHAR(160)  NOT NULL,
    [descripcion]  NVARCHAR(1000) NULL,
    [created_by]   NVARCHAR(255)  NOT NULL,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [DF_portal_evento_created_at] DEFAULT SYSUTCDATETIME(),
    [eliminado_at] DATETIME2      NULL,
    [eliminado_by] NVARCHAR(255)  NULL,
    CONSTRAINT [PK_portal_evento] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_evento]') AND name = N'portal_evento_fecha_idx'
)
  CREATE NONCLUSTERED INDEX [portal_evento_fecha_idx] ON [dbo].[portal_evento]([fecha] ASC);

/*
  ───────────────────────────── REVERSA ─────────────────────────────
  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Si ya hay eventos, se niega salvo que la sesión declare portal_reversa_eventos = 1. Respáldelos antes.

IF OBJECT_ID(N'[dbo].[portal_evento]', N'U') IS NOT NULL
BEGIN
  DECLARE @eventos INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_evento]', N'@n INT OUTPUT', @n = @eventos OUTPUT;
  IF @eventos > 0 AND TRY_CAST(SESSION_CONTEXT(N'portal_reversa_eventos') AS INT) IS NULL
    THROW 51205, N'Hay eventos del calendario del portal: respáldelos y declare portal_reversa_eventos = 1 antes de la reversa.', 1;
END

DROP TABLE IF EXISTS [dbo].[portal_evento];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261009180000_portal_eventos';
*/
