/*
  Migración: service_layer_daily_metrics
  Módulo NUEVO: métricas diarias del SAP Business One Service Layer (OLP) —
  reemplaza el Excel manual que se venía sacando a mano cada día. Cuenta
  líneas del log del balanceador del Service Layer (puerto 50000, recibe
  todo el tráfico) en serfarma07 (192.168.10.7) vía backfill histórico
  (prisma/seeds/run-service-layer-metrics-backfill.mjs) y una Tarea
  Programada de Windows diaria en pce0023 (lib/service-layer-metrics/).

  ATENCIÓN: esta migración se generó MANUALMENTE (sin permiso de shadow
  database en este entorno — P3014, CREATE DATABASE denegado en 'master'),
  mismo patrón que 20260629000000_add_organigrama_cargos,
  20260821000000_add_document_management y las demás migraciones manuales
  de este repo. El SQL se extrajo verbatim de un diff ESQUEMA-CONTRA-ESQUEMA
  (no contra la base viva, para no arrastrar el drift de las tablas del
  motor de solicitudes/workflow que intencionalmente NO están modeladas en
  Prisma):

    git show HEAD:prisma/schema.prisma > prisma/schema.prisma.before
    npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma.before \
      --to-schema-datamodel prisma/schema.prisma --script

  Qué agrega (100% ADITIVA — una sola tabla nueva, sin tocar nada más):
    - service_layer_daily_metrics: id, company (NVARCHAR(50), texto libre
      SIN FK — hoy solo "OLP"), metric_date (DATE), transaction_count (INT),
      created_at/updated_at. Único compuesto (company, metric_date) para que
      el upsert diario y el backfill sean idempotentes.

  Para registrar esta migración como aplicada en una base que YA tiene la
  tabla (p.ej. tras aplicarla a mano), use:
    npx prisma migrate resolve --applied 20260903100000_service_layer_daily_metrics
*/

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[service_layer_daily_metrics] (
    [id] INT NOT NULL IDENTITY(1,1),
    [company] NVARCHAR(50) NOT NULL,
    [metric_date] DATE NOT NULL,
    [transaction_count] INT NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [service_layer_daily_metrics_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [service_layer_daily_metrics_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [service_layer_daily_metrics_company_metric_date_key] UNIQUE NONCLUSTERED ([company],[metric_date])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
