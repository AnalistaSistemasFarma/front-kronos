/*
  PASE MANUAL (PROD) — Permisos API: catálogo «SAP». 2026-11-11.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo AGREGA filas, no borra ni cambia lo que exista):
    Agrega a dbo.api_permission un permiso por cada consulta de la API SAP (system = N'sap'):
    Compras, Ventas, Pagos y cupo, Logística y Socios de negocio (20 permisos).
    Todos son de CONSULTA (access_kind = N'consulta'): la API SAP es de solo lectura.
    En Permisos API salen como la plataforma «SAP», antes de SynerLink.

  IMPORTANTE: por ahora la API SAP (Go) NO lee estos permisos (solo acepta los tokens del portal);
  quedan listos para cuando se conecte. El MCP de SynerLink los ignora (solo carga system = 'synerlink').
  REQUISITO: antes, el script 2026-11-11-permisos-api-nivel-acceso (columna access_kind).
  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: SSMS (F5). SOLO en la ventana autorizada del pase, después de validarlo en PRUEBAS.
  REVERSA: prisma/manual/2026-11-11-permisos-api-catalogo-sap-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51783, N'Base no esperada: este script es solo para KRONOSDB.', 1;

IF COL_LENGTH(N'dbo.api_permission', N'access_kind') IS NULL
  THROW 51784, N'Falta la columna api_permission.access_kind: primero el script 2026-11-11-permisos-api-nivel-acceso.', 1;

BEGIN TRANSACTION;

-- EXEC: access_kind se valida al correr, no al compilar el lote.
EXEC(N'INSERT INTO [dbo].[api_permission] ([code], [system], [group_label], [label], [description], [active], [display_order], [access_kind])
SELECT v.code, N''sap'', v.group_label, v.label, v.description, 1, v.display_order, N''consulta''
FROM (VALUES
  (N''sap_ordenes_compra'', N''Compras'', N''Órdenes de compra'', N''Órdenes de compra del socio (PurchaseOrders): lista y detalle.'', 11),
  (N''sap_ofertas_compra'', N''Compras'', N''Ofertas de compra'', N''Ofertas de compra (PurchaseQuotations). Hoy oculta en el portal de proveedores.'', 12),
  (N''sap_entradas'', N''Compras'', N''Entradas de mercancía'', N''Entradas de mercancía (PurchaseDeliveryNotes).'', 13),
  (N''sap_devoluciones_compra'', N''Compras'', N''Devoluciones de compra'', N''Devoluciones de compra (PurchaseReturns).'', 14),
  (N''sap_facturas'', N''Compras'', N''Facturas de proveedor'', N''Facturas de proveedor con lo pagado (PurchaseInvoices).'', 15),
  (N''sap_notas_credito'', N''Compras'', N''Notas crédito de proveedor'', N''Notas crédito de proveedor (PurchaseCreditNotes).'', 16),
  (N''sap_facturas_en_tramite'', N''Compras'', N''Facturas en trámite'', N''Facturas en borrador con su estado de radicación (Drafts).'', 17),
  (N''sap_ofertas_venta'', N''Ventas'', N''Ofertas de venta'', N''Ofertas de venta (Quotations).'', 21),
  (N''sap_pedidos'', N''Ventas'', N''Pedidos'', N''Pedidos de cliente (Orders).'', 22),
  (N''sap_entregas'', N''Ventas'', N''Entregas'', N''Entregas (DeliveryNotes).'', 23),
  (N''sap_facturas_venta'', N''Ventas'', N''Facturas de venta'', N''Facturas de venta con lo pagado (Invoices).'', 24),
  (N''sap_notas_credito_venta'', N''Ventas'', N''Notas crédito de venta'', N''Notas crédito de venta (CreditNotes).'', 25),
  (N''sap_solicitudes_devolucion'', N''Ventas'', N''Solicitudes de devolución'', N''Solicitudes de devolución (ReturnRequest).'', 26),
  (N''sap_devoluciones_venta'', N''Ventas'', N''Devoluciones de venta'', N''Devoluciones de venta (Returns).'', 27),
  (N''sap_pagos'', N''Pagos y cupo'', N''Pagos a proveedores'', N''Pagos efectuados (VendorPayments).'', 31),
  (N''sap_pagos_recibidos'', N''Pagos y cupo'', N''Pagos recibidos'', N''Pagos recibidos de clientes (IncomingPayments).'', 32),
  (N''sap_cupo'', N''Pagos y cupo'', N''Cupo de crédito'', N''Cupo de crédito del socio de negocio.'', 33),
  (N''sap_cotizaciones_flete_nacional'', N''Logística'', N''Cotizaciones de flete nacional'', N''Cotizaciones de flete nacional (solo FARMALOGICA).'', 41),
  (N''sap_cotizaciones_flete_internacional'', N''Logística'', N''Cotizaciones de flete internacional'', N''Cotizaciones de flete internacional (solo FARMALOGICA). Hoy oculta en el portal.'', 42),
  (N''sap_buscar_socios'', N''Socios de negocio'', N''Buscar proveedores y clientes'', N''Buscar socios de negocio por NIT o nombre. Nunca se ofrece a un asistente de proveedores.'', 51)
) AS v(code, group_label, label, description, display_order)
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[api_permission] p WHERE p.[code] = v.code)');

COMMIT TRANSACTION;

SELECT DB_NAME() AS base,
       (SELECT COUNT(*) FROM [dbo].[api_permission] WHERE [system] = N'sap') AS permisos_sap,
       (SELECT COUNT(*) FROM [dbo].[api_permission]) AS permisos_total;
