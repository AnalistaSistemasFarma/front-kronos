/*
  Sprint 5 (Gestión Documental): subproceso NUEVO para el atajo "Cargar documento"
  (creación directa de un documento nuevo, sin pasar por el flujo estándar de "crear
  solicitud" de SynerLink) -- ver lib/document-management/access.ts,
  DOCUMENT_MANAGEMENT_REGULATORY_URL.

  Por qué un subproceso aparte del de escritura general
  ('/process/document-management/manage'): a partir de este sprint, ese atajo debe
  quedar reservado a Asuntos Regulatorios (pedido explícito de Nicolás), mientras que
  el permiso de escritura general sigue habilitando acciones del flujo de aprobación
  (revisar/aprobar/etc., ver workflowEngine.ts) en cualquier empresa. Son dos permisos
  DISTINTOS a partir de ahora, aunque hoy (2026-09-02) los tenga la misma persona.

  Estado de partida verificado antes de este seed: NO existe ningún subproceso ni
  departamento de "Asuntos Regulatorios" en esta base. El único subproceso de
  escritura de Gestión Documental (id_subprocess 41) lo tiene asignado solo Nicolás
  Rivera + una cuenta de prueba (test.sgd.horus@gsslatam.com), en Farmalógica/Ryan/
  OneLatamPharma. Este script asigna el permiso nuevo a esas MISMAS filas, para no
  quitarle capacidad a nadie en el momento del despliegue -- Nicolás puede reasignarlo
  después a las personas reales de Asuntos Regulatorios desde el admin de usuarios
  (/api/subprocesses ya lista cualquier subprocess nuevo, no hace falta UI nueva).

  Mismo patrón que prisma/seeds/document-management-permisos.sql: reusa el process
  contenedor 'Procesos' y el mecanismo de subprocess_user_company. Idempotente,
  APPEND-ONLY (sin DROP/ALTER/TRUNCATE). SQL Server (provider sqlserver).
*/

DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubUrlWrite NVARCHAR(255) = '/process/document-management/manage';
DECLARE @SubNameRegulatory NVARCHAR(255) = 'Gestión Documental (Asuntos Regulatorios - carga directa)';
DECLARE @SubUrlRegulatory NVARCHAR(255) = '/process/document-management/manage/regulatory';

/* 1) Process contenedor (reusa el mismo que document-management-permisos.sql). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso nuevo (idempotente por subprocess_url). */
DECLARE @SubIdRegulatory INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrlRegulatory ORDER BY id_subprocess
);
IF @SubIdRegulatory IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubNameRegulatory, @ProcessId, @SubUrlRegulatory);
  SET @SubIdRegulatory = SCOPE_IDENTITY();
END

/* 3) Otorgar el permiso nuevo a quien HOY tiene el de escritura general -- transición
      sin pérdida de capacidad. Solo inserta las filas que falten. */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubIdRegulatory, suc.id_company_user
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url = @SubUrlWrite
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc2
    WHERE suc2.id_subprocess = @SubIdRegulatory AND suc2.id_company_user = suc.id_company_user
  );

/* Diagnóstico: qué quedó otorgado en los 3 subprocesos de Gestión Documental. */
SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url LIKE '/process/document-management%'
ORDER BY c.company, s.subprocess_url;
