/*
  Migración: BITÁCORA DE PROCESO — actividades de TEXTO LIBRE — 2026-10-17.

  Nicolás (2026-10-17 19:10): «un tipo de actividad como texto libre para los operadores».
    ot_actividad.texto_libre     BIT NOT NULL DEFAULT 0 — la actividad pide un texto OBLIGATORIO
                                 al registrarla (lo marca Gestión en el catálogo).
    ot_registro.es_texto_libre   BIT NOT NULL DEFAULT 0 — el registro se hizo como texto libre
                                 (queda fijo aunque luego cambie el catálogo); el texto va en
                                 `observacion` (NVARCHAR(500)).

  Solo AGREGA dos columnas con valor por defecto 0: no cambia ningún dato existente ni el
  comportamiento hasta que Gestión marque una actividad. Los triggers de ot_registro (sin
  edición ni borrado) no se tocan: ALTER TABLE … ADD no los dispara.
  IDEMPOTENTE (también corre sobre el esquema de `prisma db push` en la CI). Se corre A MANO
  (producción no está baselined), primero en KRONOSDB_PRUEBAS. Envolturas con guarda de base:
    prisma/manual/2026-10-17-bitacora-proceso-texto-libre-PRUEBAS.sql
    prisma/manual/2026-10-17-bitacora-proceso-texto-libre-PROD.sql
  REVERSA: prisma/manual/2026-10-17-bitacora-proceso-texto-libre-reversa.sql
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL OR OBJECT_ID(N'dbo.ot_registro', N'U') IS NULL
  THROW 51480, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

IF COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') IS NULL
  ALTER TABLE [dbo].[ot_actividad] ADD [texto_libre] BIT NOT NULL CONSTRAINT [ot_actividad_texto_libre_df] DEFAULT 0;

IF COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') IS NULL
  ALTER TABLE [dbo].[ot_registro] ADD [es_texto_libre] BIT NOT NULL CONSTRAINT [ot_registro_es_texto_libre_df] DEFAULT 0;
