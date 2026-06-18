/**
 * Resolución del solicitante en casos de mesa de ayuda.
 * En datos legacy, c.requester suele ser id_company_user del operador;
 * el solicitante real aparece al inicio de subject_case ("Nombre - asunto").
 */

export const SUBJECT_REQUESTER_NAME_SQL = `
  NULLIF(
    LTRIM(RTRIM(
      CASE
        WHEN CHARINDEX(' -', c.subject_case) > 0
          THEN LEFT(c.subject_case, CHARINDEX(' -', c.subject_case) - 1)
        WHEN CHARINDEX('-', c.subject_case) > 0
          THEN LEFT(c.subject_case, CHARINDEX('-', c.subject_case) - 1)
        ELSE NULL
      END
    )),
    ''
  )
`;

export const REQUESTER_JOINS = `
  LEFT JOIN [user] ur_direct ON CAST(ur_direct.id AS NVARCHAR(255)) = CAST(c.requester AS NVARCHAR(255))
  LEFT JOIN company_user cu_req ON cu_req.id_company_user = TRY_CAST(c.requester AS INT)
  LEFT JOIN [user] ur_cu ON ur_cu.id = cu_req.id_user
`;

/** Nombre visible: prioriza el parseado del asunto (solicitante real en legacy). */
export const REQUESTER_NAME_SQL = `
  COALESCE(
    ${SUBJECT_REQUESTER_NAME_SQL},
    ur_direct.name,
    ur_cu.name
  )
`;

export const REQUESTER_EMAIL_SQL = `
  COALESCE(
    (
      SELECT TOP 1 ux.email
      FROM [user] ux
      WHERE ${SUBJECT_REQUESTER_NAME_SQL} IS NOT NULL
        AND LTRIM(RTRIM(ux.name)) = LTRIM(RTRIM(${SUBJECT_REQUESTER_NAME_SQL}))
        AND ux.email IS NOT NULL
        AND LTRIM(RTRIM(ux.email)) != ''
      ORDER BY CASE WHEN ux.isActive = 1 THEN 0 ELSE 1 END, ux.name
    ),
    ur_direct.email,
    ur_cu.email
  )
`;

export const REQUESTER_KEY_SQL = `
  COALESCE(
    CAST(ur_direct.id AS NVARCHAR(255)),
    'name:' + LOWER(LTRIM(RTRIM(${REQUESTER_NAME_SQL})))
  )
`;

/** Condición: el caso pertenece al usuario identificado por @requester_id */
export const REQUESTER_ID_FILTER_SQL = `
  (
    ${REQUESTER_KEY_SQL} = @requester_id
    OR CAST(c.requester AS NVARCHAR(255)) = @requester_id
    OR ur_direct.id = @requester_id
    OR ur_cu.id = @requester_id
    OR EXISTS (
      SELECT 1 FROM [user] ux
      WHERE ux.id = @requester_id
        AND (
          LTRIM(RTRIM(ux.name)) != ''
          AND (
            ${REQUESTER_NAME_SQL} LIKE '%' + ux.name + '%'
            OR ux.name LIKE '%' + ${REQUESTER_NAME_SQL} + '%'
          )
        )
    )
    OR (
      @requester_id LIKE 'name:%'
      AND LOWER(${REQUESTER_NAME_SQL}) = LOWER(SUBSTRING(@requester_id, 6, 4000))
    )
  )
`;

/** Condición: el caso pertenece a quien tiene ese correo */
export const REQUESTER_EMAIL_FILTER_SQL = `
  (
    LOWER(LTRIM(RTRIM(${REQUESTER_EMAIL_SQL}))) = LOWER(LTRIM(RTRIM(@requester_email)))
    OR EXISTS (
      SELECT 1 FROM [user] ux
      WHERE LOWER(LTRIM(RTRIM(ux.email))) = LOWER(LTRIM(RTRIM(@requester_email)))
        AND LTRIM(RTRIM(ux.name)) != ''
        AND (
          ${REQUESTER_NAME_SQL} LIKE '%' + ux.name + '%'
          OR ux.name LIKE '%' + ${REQUESTER_NAME_SQL} + '%'
          OR CAST(c.requester AS NVARCHAR(255)) = CAST(ux.id AS NVARCHAR(255))
          OR EXISTS (
            SELECT 1 FROM company_user cux
            WHERE cux.id_user = ux.id
              AND cux.id_company_user = TRY_CAST(c.requester AS INT)
          )
        )
    )
  )
`;

/** Búsqueda libre por nombre, correo o referencia legacy */
export const REQUESTER_SEARCH_FILTER_SQL = `
  (
    ${REQUESTER_NAME_SQL} LIKE '%' + @requester_search + '%'
    OR ${REQUESTER_EMAIL_SQL} LIKE '%' + @requester_search + '%'
    OR EXISTS (
      SELECT 1 FROM [user] ux
      WHERE (
        ux.email LIKE '%' + @requester_search + '%'
        OR ux.name LIKE '%' + @requester_search + '%'
      )
      AND LTRIM(RTRIM(ux.name)) != ''
      AND (
        ${REQUESTER_NAME_SQL} LIKE '%' + ux.name + '%'
        OR ux.name LIKE '%' + ${REQUESTER_NAME_SQL} + '%'
        OR CAST(c.requester AS NVARCHAR(255)) = CAST(ux.id AS NVARCHAR(255))
        OR EXISTS (
          SELECT 1 FROM company_user cux
          WHERE cux.id_user = ux.id
            AND cux.id_company_user = TRY_CAST(c.requester AS INT)
        )
      )
    )
  )
`;
