-- Integración Synerlink → SAPSEND · Fase 2 (updateStatus + archivos)
-- Columnas de trazabilidad en requests_general. Idempotente. Ejecutar en la BD de SynerLink.

-- updateStatus (autorización del área en SAPSEND)
IF COL_LENGTH('requests_general', 'sapsend_status_request') IS NULL
    ALTER TABLE requests_general ADD sapsend_status_request NVARCHAR(60) NULL;   -- estado de workflow en SAPSEND

IF COL_LENGTH('requests_general', 'sapsend_auth_status') IS NULL
    ALTER TABLE requests_general ADD sapsend_auth_status NVARCHAR(20) NULL;      -- sent | conflict | failed

IF COL_LENGTH('requests_general', 'sapsend_auth_error') IS NULL
    ALTER TABLE requests_general ADD sapsend_auth_error NVARCHAR(500) NULL;

IF COL_LENGTH('requests_general', 'sapsend_auth_synced_at') IS NULL
    ALTER TABLE requests_general ADD sapsend_auth_synced_at DATETIME NULL;

-- Archivos (reenvío a SAPSEND)
IF COL_LENGTH('requests_general', 'sapsend_files_synced_at') IS NULL
    ALTER TABLE requests_general ADD sapsend_files_synced_at DATETIME NULL;

IF COL_LENGTH('requests_general', 'sapsend_files_error') IS NULL
    ALTER TABLE requests_general ADD sapsend_files_error NVARCHAR(500) NULL;
