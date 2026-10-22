/*
  Migración: BITÁCORA DE PROCESO — inspector e íconos — ADITIVA. 2026-10-13.

  Especificación oficial de Farmalógica («Bitácora de Proceso Plantas
  Farmalógica», Amanda Casiano, 2026-10-13): el encabezado lleva Inspector y
  las intervenciones se muestran con pictograma.

    1. ot_orden_trabajo.id_inspector  NVARCHAR(50) NULL  (user.id del inspector, elegido al abrir)
    2. ot_actividad.icono             NVARCHAR(40) NULL  (clave de un ícono de la lista cerrada)

  Solo agrega columnas NULL a tablas del módulo (no toca tablas existentes de
  SynerLink). Requiere la migración 20261013180000_ordenes_trabajo_p0.
  IDEMPOTENTE. Se corre A MANO (producción no está baselined), justo después de
  la anterior. REVERSA: la general prisma/manual/2026-10-13-bitacora-proceso-p0-reversa.sql
  (borra las tablas del módulo completas).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  THROW 51340, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_inspector') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD [id_inspector] NVARCHAR(50) NULL');

IF COL_LENGTH(N'dbo.ot_actividad', N'icono') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_actividad] ADD [icono] NVARCHAR(40) NULL');
