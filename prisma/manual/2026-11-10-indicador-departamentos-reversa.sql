/* REVERSA — quita dbo.agent_departamento (departamento asignado a mano a los agentes del indicador).
   Efecto: el indicador vuelve al departamento del último corte de «Casos de uso» (el código lo tolera,
   no hace falta revertir el código). Pérdida: solo las asignaciones manuales. No toca otras tablas. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51612, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.agent_departamento', N'U') IS NOT NULL
  DROP TABLE [dbo].[agent_departamento];
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_departamento', N'U') AS agent_departamento;
