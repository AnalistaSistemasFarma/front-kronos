/*
  PROD — Compras: estado «draft» en purchase_authorization (solicitud de compra guardada
  «En Borrador» en Mis solicitudes, sin flujo; como la oferta de Ventas). 2026-11-06.
  BASE: KRONOSDB. Idempotente. Solo amplía el CHECK (aditivo). Reversa: 2026-11-06-compras-borrador-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB' THROW 51601, N'Base no esperada: solo KRONOSDB.', 1;
IF OBJECT_ID(N'dbo.purchase_authorization', N'U') IS NULL THROW 51602, N'Falta dbo.purchase_authorization (correr antes 2026-10-21-compras-autorizacion).', 1;

BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_purchase_authorization_status'
             AND definition NOT LIKE N'%draft%')
  BEGIN
    ALTER TABLE dbo.purchase_authorization DROP CONSTRAINT CK_purchase_authorization_status;
    ALTER TABLE dbo.purchase_authorization ADD CONSTRAINT CK_purchase_authorization_status CHECK ([status] IN
      (N'draft', N'pending', N'publishing', N'approved', N'rejected', N'quoted', N'cancelled', N'publish_error', N'reject_error'));
  END
COMMIT TRANSACTION;

SELECT name, definition FROM sys.check_constraints WHERE name = N'CK_purchase_authorization_status';
