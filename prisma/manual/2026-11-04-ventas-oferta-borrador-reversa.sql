/* REVERSA — Ventas: ofertas en borrador (2026-11-04-ventas-oferta-borrador-{PRUEBAS,PROD}.sql). Los borradores quedan en SAP. */
SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB') THROW 51530, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.sales_offer_draft', N'U') IS NOT NULL DROP TABLE [dbo].[sales_offer_draft];
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.sales_offer_draft', N'U') AS tabla;
