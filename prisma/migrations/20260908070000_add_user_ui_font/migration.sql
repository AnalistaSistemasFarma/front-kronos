/*
  Preferencia de TIPOGRAFÍA por usuario.

  Pedido de Nicolás (2026-09-08): "o que sea configurable la fuente mejor,
  desde mi perfil". La cadena de fuentes del sistema la resuelve el navegador y
  Chrome en Android no lee la fuente del tema del fabricante, así que no había
  forma confiable de respetar la del equipo. Que el usuario escoja, sí.

  Guarda una CLAVE del catálogo de lib/theme/fonts.ts (sistema | dispositivo |
  serif | mono), NO una cadena CSS: así lo que viene de la base nunca puede
  inyectar CSS arbitrario en :root.

  ESTRICTAMENTE ADITIVA: una columna que admite NULL, con default. No toca
  datos, no reescribe la tabla y no cambia restricciones, así que se aplica en
  caliente. Las filas existentes quedan con 'sistema', que es exactamente lo
  que se ve hoy.

  Idempotente: se puede correr dos veces sin romper nada.

  OJO: en este repositorio `prisma migrate deploy` NO corre en los despliegues
  (la base de producción no está baselined, da P3005 — ver
  .github/workflows/main.yml). Esta migración queda como registro; el ALTER se
  aplica A MANO en KRONOSDB_PRUEBAS y en KRONOSDB antes del pase.
*/
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[user]')
    AND name = 'uiFont'
)
BEGIN
  ALTER TABLE [dbo].[user]
    ADD [uiFont] NVARCHAR(1000) NULL CONSTRAINT [user_uiFont_df] DEFAULT 'sistema';
END
