-- Casos cerrados (resueltos/cancelados) sin quien cerró registrado en id_executor_final.

-- Resumen por estado
SELECT
  sc.id_status_case,
  sc.status,
  COUNT(*) AS total_cerrados,
  SUM(
    CASE
      WHEN NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NULL
      THEN 1 ELSE 0
    END
  ) AS sin_executor_final,
  SUM(
    CASE
      WHEN NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NOT NULL
      THEN 1 ELSE 0
    END
  ) AS con_executor_final
FROM [case] c
INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
WHERE c.id_status_case IN (2, 3)
GROUP BY sc.id_status_case, sc.status
ORDER BY sc.id_status_case;

-- Detalle de casos sin registro (más recientes primero)
SELECT TOP 200
  c.id_case,
  sc.status,
  c.subject_case,
  c.creation_date,
  c.end_date,
  c.id_executor_final,
  u_asig.name AS tecnico_asignado,
  u_ex.name AS executor_registrado
FROM [case] c
INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
LEFT JOIN [user] u_asig ON u_asig.id = cu.id_user
LEFT JOIN [user] u_ex ON CAST(u_ex.id AS NVARCHAR(255)) = CAST(c.id_executor_final AS NVARCHAR(255))
WHERE c.id_status_case IN (2, 3)
  AND NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NULL
ORDER BY COALESCE(c.end_date, c.creation_date) DESC, c.id_case DESC;
