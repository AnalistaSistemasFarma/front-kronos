-- Usuarios SIN LOGIN de KRONOSDB_PRUEBAS para el conector «kronos-pruebas-sql» del puente de hilos
-- (orden de Nicolás Rivera, 2026-10-22). El conector se conecta con la credencial de testing y se
-- SUPLANTA (EXECUTE AS USER … WITH NO REVERT) a uno de estos usuarios. Como KRONOSDB_PRUEBAS NO es
-- TRUSTWORTHY, una suplantación de usuario de base no puede salir de ella: SQL Server niega cualquier
-- otra base del servidor (KRONOSDB incluida). Idempotente. SOLO PRUEBAS: nunca correrlo en KRONOSDB.
IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
BEGIN
  RAISERROR(N'Este script solo corre en KRONOSDB_PRUEBAS.', 16, 1);
  RETURN;
END;
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = DB_NAME() AND is_trustworthy_on = 1)
BEGIN
  RAISERROR(N'KRONOSDB_PRUEBAS es TRUSTWORTHY: la suplantación no encerraría la sesión. No se crea nada.', 16, 1);
  RETURN;
END;
IF USER_ID(N'agente_hilos_lectura') IS NULL CREATE USER [agente_hilos_lectura] WITHOUT LOGIN WITH DEFAULT_SCHEMA = [dbo];
IF USER_ID(N'agente_hilos_escritura') IS NULL CREATE USER [agente_hilos_escritura] WITHOUT LOGIN WITH DEFAULT_SCHEMA = [dbo];
IF IS_ROLEMEMBER(N'db_datareader', N'agente_hilos_lectura') = 0 ALTER ROLE [db_datareader] ADD MEMBER [agente_hilos_lectura];
GRANT VIEW DEFINITION TO [agente_hilos_lectura];
IF IS_ROLEMEMBER(N'db_datareader', N'agente_hilos_escritura') = 0 ALTER ROLE [db_datareader] ADD MEMBER [agente_hilos_escritura];
IF IS_ROLEMEMBER(N'db_datawriter', N'agente_hilos_escritura') = 0 ALTER ROLE [db_datawriter] ADD MEMBER [agente_hilos_escritura];
IF IS_ROLEMEMBER(N'db_ddladmin', N'agente_hilos_escritura') = 0 ALTER ROLE [db_ddladmin] ADD MEMBER [agente_hilos_escritura];
GRANT EXECUTE, VIEW DEFINITION, REFERENCES, SHOWPLAN TO [agente_hilos_escritura];
SELECT name, type_desc, authentication_type_desc,
       IS_ROLEMEMBER(N'db_datareader', name) AS lee, IS_ROLEMEMBER(N'db_datawriter', name) AS escribe, IS_ROLEMEMBER(N'db_ddladmin', name) AS ddl
FROM sys.database_principals WHERE name IN (N'agente_hilos_lectura', N'agente_hilos_escritura');
