/*
  Migración: preparers_process_category
  Personas autorizadas a preparar documentos (Orion) por flujo de trabajo.

  Misma idea que viewers_process_category (Observadores): se asignan en
  Administración de flujo de trabajo → Preparadores documento.
  El permiso “Preparar firma” solo basta si además estás en esta lista del
  process_category de la solicitud.

  ATENCIÓN: generada MANUALMENTE. Idempotente.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'preparers_process_category')
BEGIN
  CREATE TABLE [dbo].[preparers_process_category] (
    [id]                   INT IDENTITY(1,1) NOT NULL,
    [id_preparer]          NVARCHAR(1000)    NOT NULL,
    [id_process_category]  INT               NOT NULL,
    CONSTRAINT [PK_preparers_process_category] PRIMARY KEY CLUSTERED ([id] ASC)
  );

  CREATE NONCLUSTERED INDEX [IX_preparers_process_category_process]
    ON [dbo].[preparers_process_category] ([id_process_category]);

  CREATE NONCLUSTERED INDEX [IX_preparers_process_category_user]
    ON [dbo].[preparers_process_category] ([id_preparer]);
END
GO
