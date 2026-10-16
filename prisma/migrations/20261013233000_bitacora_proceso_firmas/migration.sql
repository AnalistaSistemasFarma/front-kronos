/*
  Migración: BITÁCORA DE PROCESO — FIRMAS ELECTRÓNICAS de cierre y verificación — ADITIVA. 2026-10-13.

  Nicolás: «recuerda que las firmas también son digitales, para eso tenemos firmas ya construidas».
  Al cerrar firma el SUPERVISOR («Cerró») y luego el INSPECTOR («Verificó»).

  La firma reutiliza lo que SynerLink ya tiene (no es un sistema de firmas nuevo):
    - reautenticación con la contraseña de SynerLink (misma regla del inicio de sesión);
    - texto de consentimiento de firma electrónica de GSS Firma (lib/orion/signingLegalConsent.ts);
    - la firma REGISTRADA de la persona en GSS Firma (Orión) como imagen visible, si la tiene.
  Aquí solo se guarda la EVIDENCIA de cada firma de la bitácora:

    ot_firma  una fila por firma (rol SUPERVISOR | INSPECTOR, una de cada una por bitácora):
              quién, significado, hora del servidor, huella SHA-256 del contenido firmado,
              método de autenticación, versión del consentimiento, copia de la imagen de la
              firma registrada (y su huella), IP y navegador.
              SOLO INSERCIÓN: un trigger impide editarla o borrarla.

  Requiere 20261013180000_ordenes_trabajo_p0. IDEMPOTENTE. Se corre A MANO.
  REVERSA: prisma/manual/2026-10-13-bitacora-proceso-p0-reversa.sql (borra las tablas del módulo).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  THROW 51360, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

IF OBJECT_ID(N'dbo.ot_firma', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ot_firma] (
    [id_firma]         INT IDENTITY(1,1) NOT NULL,
    [id_orden_trabajo] INT            NOT NULL,
    [rol]              NVARCHAR(12)   NOT NULL,
    [significado]      NVARCHAR(20)   NOT NULL,
    [id_user]          NVARCHAR(50)   NOT NULL,
    [signer_email]     NVARCHAR(255)  NOT NULL,
    [signer_name]      NVARCHAR(255)  NULL,
    [firmado_en]       DATETIME2      NOT NULL CONSTRAINT [ot_firma_firmado_en_df] DEFAULT sysutcdatetime(),
    [content_sha256]   CHAR(64)       NOT NULL,
    [auth_method]      NVARCHAR(40)   NOT NULL,
    [consent_version]  NVARCHAR(60)   NOT NULL,
    [firma_png]        NVARCHAR(MAX)  NULL,
    [firma_sha256]     CHAR(64)       NULL,
    [ip]               NVARCHAR(64)   NULL,
    [user_agent]       NVARCHAR(400)  NULL,
    CONSTRAINT [ot_firma_pkey] PRIMARY KEY CLUSTERED ([id_firma]),
    CONSTRAINT [UQ_ot_firma_rol] UNIQUE NONCLUSTERED ([id_orden_trabajo], [rol]),
    CONSTRAINT [ot_firma_id_orden_trabajo_fkey] FOREIGN KEY ([id_orden_trabajo]) REFERENCES [dbo].[ot_orden_trabajo]([id_orden_trabajo]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF OBJECT_ID(N'dbo.CK_ot_firma_rol', N'C') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD CONSTRAINT [CK_ot_firma_rol] CHECK ([rol] IN (N''SUPERVISOR'', N''INSPECTOR''))');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_firma_inmutable] ON [dbo].[ot_firma]
INSTEAD OF UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51361, N''Las firmas de la bitácora no se pueden editar ni borrar.'', 1;
END');
