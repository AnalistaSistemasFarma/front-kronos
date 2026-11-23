/*
  Módulo de Salas (/process/salas) — permisos. 2026-11-17.

  Crea (si no existen) los tres subprocesos del módulo bajo el proceso
  @proceso (por defecto «Administración»; si no existe, se crea):

    Salas                      /process/salas            ver la ocupación (entrada del menú)
    Salas - Reservar           /process/salas/reservar   reservar y cancelar lo propio (marcador, oculto en el hub)
    Salas - Administrador      /process/salas/admin      cancelar reuniones de otros (marcador, oculto en el hub)

  NO asigna permisos a nadie: se asignan por empresa en Administración → Usuarios
  (o con el bloque OPCIONAL del final).

  - Verifica la base antes de cualquier cambio (@base_esperada).
  - Idempotente: se puede correr varias veces.
  - Conteo antes y después. Reversa al final (comentada).

  Lo corre el operador autorizado (Nicolás Rivera o Cristian Baldión; en el
  pase a producción, Orus con el OK de Nicolás).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @base_esperada sysname = N'KRONOSDB_PRUEBAS';   -- en producción: N'KRONOSDB'
DECLARE @proceso nvarchar(200) = N'Administración';

DECLARE @base_actual sysname = DB_NAME();
IF @base_actual <> @base_esperada
BEGIN
  RAISERROR(N'Base equivocada: %s (se esperaba %s). No se hizo nada.', 16, 1, @base_actual, @base_esperada);
  RETURN;
END;

SELECT N'ANTES' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url, p.process
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/salas%';

BEGIN TRAN;

DECLARE @id_process int = (SELECT TOP 1 id_process FROM dbo.process WHERE process = @proceso ORDER BY id_process);
IF @id_process IS NULL
BEGIN
  INSERT INTO dbo.process (process) VALUES (@proceso);
  SET @id_process = SCOPE_IDENTITY();
END;

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas', @id_process, N'/process/salas');

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas/reservar')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas - Reservar', @id_process, N'/process/salas/reservar');

IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE subprocess_url = N'/process/salas/admin')
  INSERT INTO dbo.subprocess (subprocess, id_process, subprocess_url) VALUES (N'Salas - Administrador', @id_process, N'/process/salas/admin');

COMMIT;

SELECT N'DESPUÉS' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url, p.process
FROM dbo.subprocess s JOIN dbo.process p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/salas%';

/* ---------------------------------------------------------------------------
   OPCIONAL — asignar un nivel a una persona en TODAS sus empresas.
   Cambie el correo y la URL del nivel (/process/salas, /process/salas/reservar
   o /process/salas/admin). Para «reservar» o «admin» asigne también
   /process/salas, que es la entrada del menú.

DECLARE @correo nvarchar(320) = N'persona@gsslatam.com';
DECLARE @url nvarchar(200) = N'/process/salas';
INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
SELECT s.id_subprocess, cu.id_company_user
FROM dbo.[user] u
JOIN dbo.company_user cu ON cu.id_user = u.id
JOIN dbo.subprocess s ON s.subprocess_url = @url
WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(@correo)
  AND NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company x
                  WHERE x.id_subprocess = s.id_subprocess AND x.id_company_user = cu.id_company_user);
--------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   REVERSA — quita los permisos asignados y los tres subprocesos.
   (El proceso padre no se borra: puede tener otros subprocesos.)

IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50000, N'Base equivocada', 1;
BEGIN TRAN;
DELETE suc FROM dbo.subprocess_user_company suc
JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url IN (N'/process/salas', N'/process/salas/reservar', N'/process/salas/admin');
DELETE FROM dbo.subprocess
WHERE subprocess_url IN (N'/process/salas', N'/process/salas/reservar', N'/process/salas/admin');
COMMIT;
--------------------------------------------------------------------------- */
