/*
  Migración: add_articles_log_object
  Módulo Artículos — bitácora de cambios.

  Agrega la columna sap_endpoints.articles_log_object: nombre del UDO de SAP
  (tipo MasterData) donde se registra cada cambio de artículo por empresa
  (ej. ART_CHG_LOG en OLP). Null = la empresa no registra bitácora.

  100% ADITIVA: solo ADD COLUMN, sin DROP/ALTER de columnas existentes.
  Idempotente (guarda IF COL_LENGTH). Aplicada a mano en KRONOSDB y
  KRONOSDB_PRUEBAS (la BD de prod no está baselined para migrate deploy).
*/

IF COL_LENGTH('dbo.sap_endpoints', 'articles_log_object') IS NULL
    ALTER TABLE [dbo].[sap_endpoints] ADD [articles_log_object] NVARCHAR(100) NULL;
