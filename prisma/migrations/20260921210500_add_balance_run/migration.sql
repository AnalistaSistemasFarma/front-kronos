CREATE TABLE [dbo].[balance_run] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [id_company] INT NOT NULL,
    [triggered_by] NVARCHAR(255) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [started_at] DATETIME2 NOT NULL CONSTRAINT [balance_run_started_at_df] DEFAULT CURRENT_TIMESTAMP,
    [finished_at] DATETIME2 NULL,
    [balance_duration_ms] INT NULL,
    [acumulado_duration_ms] INT NULL,
    [error_message] NVARCHAR(MAX) NULL,

    CONSTRAINT [balance_run_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [balance_run_id_company_id_idx] ON [dbo].[balance_run]([id_company], [id]);
CREATE INDEX [balance_run_status_idx] ON [dbo].[balance_run]([status]);
