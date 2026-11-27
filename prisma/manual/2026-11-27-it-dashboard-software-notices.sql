/*
  Dashboard TI - software notifications (2026-11-27). Run AFTER
  2026-11-27-it-dashboard-software.sql.

  1. Type «dominio» allowed in it_software.kind.
  2. Columns notify_emails (list of e-mails), notice_sent_for (expiration date
     already notified) and notice_sent_at.
  3. One row in dbo.scheduled_job: job_type «it_software_expiry», every day at
     7:00 a. m. (data row of the central scheduler).

  - Checks the database before any change (@expected_db).
  - Idempotent.
  - One transaction: COMMIT only if the validation passes, otherwise
    ROLLBACK + THROW. Never leaves a transaction open.

  PRUEBAS: already applied in KRONOSDB_PRUEBAS on 2026-11-27.
  PRODUCTION: change @expected_db to N'KRONOSDB'; run by the authorized
  operator (Nicolas Rivera or Cristian Baldion). Rollback at the end.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @expected_db sysname = N'KRONOSDB_PRUEBAS';   -- production: N'KRONOSDB'
DECLARE @current_db sysname = DB_NAME();
IF @current_db <> @expected_db
BEGIN
  RAISERROR(N'Wrong database: %s (expected %s). Nothing was changed.', 16, 1, @current_db, @expected_db);
  RETURN;
END;
IF OBJECT_ID(N'dbo.it_software', N'U') IS NULL
BEGIN
  RAISERROR(N'Table it_software not found. Run 2026-11-27-it-dashboard-software.sql first. Nothing was changed.', 16, 1);
  RETURN;
END;

BEGIN TRY
  BEGIN TRAN;

  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_it_software_kind' AND definition NOT LIKE N'%dominio%')
    EXEC (N'ALTER TABLE dbo.it_software DROP CONSTRAINT CK_it_software_kind;');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_it_software_kind')
    EXEC (N'ALTER TABLE dbo.it_software ADD CONSTRAINT CK_it_software_kind CHECK (kind IN (N''software'', N''certificado'', N''dominio''));');

  IF COL_LENGTH(N'dbo.it_software', N'notify_emails') IS NULL
    EXEC (N'ALTER TABLE dbo.it_software ADD notify_emails nvarchar(2600) NULL;');
  IF COL_LENGTH(N'dbo.it_software', N'notice_sent_for') IS NULL
    EXEC (N'ALTER TABLE dbo.it_software ADD notice_sent_for date NULL;');
  IF COL_LENGTH(N'dbo.it_software', N'notice_sent_at') IS NULL
    EXEC (N'ALTER TABLE dbo.it_software ADD notice_sent_at datetime2(0) NULL;');

  IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM dbo.scheduled_job WHERE job_type = N'it_software_expiry')
  BEGIN
    DECLARE @Next DATETIME = DATEADD(HOUR, 7, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
    IF @Next <= GETDATE() SET @Next = DATEADD(DAY, 1, @Next);
    EXEC sp_executesql N'INSERT INTO dbo.scheduled_job (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
      VALUES (N''Dashboard TI · avisos de vencimiento de software'', N''it_software_expiry'', NULL, N''0 7 * * *'', @Next, 1, N''dashboard-ti'', N''sistema'', GETDATE());',
      N'@Next DATETIME', @Next = @Next;
  END;

  IF COL_LENGTH(N'dbo.it_software', N'notify_emails') IS NULL
     OR COL_LENGTH(N'dbo.it_software', N'notice_sent_for') IS NULL
     OR NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_it_software_kind' AND definition LIKE N'%dominio%')
     OR (SELECT COUNT(*) FROM dbo.scheduled_job WHERE job_type = N'it_software_expiry') <> 1
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed. Everything was rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS db,
  (SELECT definition FROM sys.check_constraints WHERE name = N'CK_it_software_kind') AS kind_check,
  COL_LENGTH(N'dbo.it_software', N'notify_emails') AS notify_emails,
  (SELECT COUNT(*) FROM dbo.scheduled_job WHERE job_type = N'it_software_expiry') AS job;

/* ---------------------------------------------------------------------------
   ROLLBACK

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
BEGIN TRY
  BEGIN TRAN;
  DELETE r FROM dbo.scheduled_job_run r JOIN dbo.scheduled_job j ON j.id = r.id_job WHERE j.job_type = N'it_software_expiry';
  DELETE FROM dbo.scheduled_job WHERE job_type = N'it_software_expiry';
  ALTER TABLE dbo.it_software DROP COLUMN notify_emails, notice_sent_for, notice_sent_at;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
--------------------------------------------------------------------------- */
