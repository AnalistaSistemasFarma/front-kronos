/*
  REVERSA — quita «draft» del CHECK de purchase_authorization. Las filas en «draft» pasan a
  «cancelled» (sus solicitudes «En Borrador» quedan canceladas) antes de restringir.
  Sirve en KRONOSDB_PRUEBAS y KRONOSDB.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB') THROW 51603, N'Base no esperada.', 1;
BEGIN TRANSACTION;
  UPDATE rg SET status_req = 3
  FROM requests_general rg JOIN dbo.purchase_authorization pa ON pa.id_request_general = rg.id
  WHERE pa.status = N'draft' AND rg.status_req = 6;
  UPDATE dbo.purchase_authorization SET status = N'cancelled', updated_at = sysutcdatetime() WHERE status = N'draft';
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_purchase_authorization_status' AND definition LIKE N'%draft%')
  BEGIN
    ALTER TABLE dbo.purchase_authorization DROP CONSTRAINT CK_purchase_authorization_status;
    ALTER TABLE dbo.purchase_authorization ADD CONSTRAINT CK_purchase_authorization_status CHECK ([status] IN
      (N'pending', N'publishing', N'approved', N'rejected', N'quoted', N'cancelled', N'publish_error', N'reject_error'));
  END
COMMIT TRANSACTION;
