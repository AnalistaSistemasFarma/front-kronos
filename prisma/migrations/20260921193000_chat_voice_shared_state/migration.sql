-- Keep WebRTC negotiation state in SQL so clustered production instances share it.
-- Idempotent for environments where the audit table already exists.
IF OBJECT_ID(N'dbo.chat_voice_call', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.chat_voice_call', N'offer_sdp') IS NULL
    ALTER TABLE dbo.chat_voice_call ADD offer_sdp NVARCHAR(MAX) NOT NULL CONSTRAINT chat_voice_call_offer_sdp_df DEFAULT N'';
  IF COL_LENGTH(N'dbo.chat_voice_call', N'answer_sdp') IS NULL
    ALTER TABLE dbo.chat_voice_call ADD answer_sdp NVARCHAR(MAX) NULL;
  IF COL_LENGTH(N'dbo.chat_voice_call', N'error') IS NULL
    ALTER TABLE dbo.chat_voice_call ADD error NVARCHAR(400) NULL;
  IF COL_LENGTH(N'dbo.chat_voice_call', N'claimed') IS NULL
    ALTER TABLE dbo.chat_voice_call ADD claimed BIT NOT NULL CONSTRAINT chat_voice_call_claimed_df DEFAULT 0;
END;
