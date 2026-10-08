/*
  PASE DEL SGC A PRODUCCIÓN — PASO 9b (decisión pendiente de Calidad):
  el SQL del S5 deja el correo de avisos de vencimiento ENCENDIDO por defecto.
  Mientras Calidad no confirme destinatarios y textos, se deja APAGADO (la
  campana/push sigue funcionando). Para encenderlo después: «Calendario de
  vencimientos → Avisos (Calidad)», con motivo (queda en auditoría).
*/
UPDATE sgc.review_alert_config SET email_enabled = 0,
  change_reason = N'Pase a producción: correo de avisos apagado hasta que Aseguramiento de Calidad confirme destinatarios y textos (la campana y el push siguen activos).',
  updated_by = N'nicolas.rivera@gsslatam.com', updated_at = SYSUTCDATETIME()
WHERE id_company = 3 AND scope_key = N'empresa' AND email_enabled = 1;
IF @@ROWCOUNT > 0
  INSERT INTO sgc.audit_log (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  VALUES (3, SYSUTCDATETIME(), N'nicolas.rivera@gsslatam.com', N'vencimiento.configurado', N'review_alert_config', N'empresa', N'{"emailEnabled":false}', N'Pase a producción: correo de avisos apagado hasta confirmación de Calidad.');
SELECT scope_key, offsets_json, email_enabled FROM sgc.review_alert_config WHERE id_company = 3;
