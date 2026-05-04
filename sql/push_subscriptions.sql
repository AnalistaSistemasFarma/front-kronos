-- Tabla para almacenar suscripciones push (Web Push API)
CREATE TABLE push_subscriptions (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  user_email  NVARCHAR(255) NOT NULL,
  endpoint    NVARCHAR(MAX) NOT NULL,
  p256dh      NVARCHAR(255) NOT NULL,
  auth        NVARCHAR(255) NOT NULL,
  created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  updated_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_push_subscriptions_user_email ON push_subscriptions(user_email);
