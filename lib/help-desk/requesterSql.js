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

/** Correo de contacto guardado en el caso (asignado por el admin). */
export const CASE_CONTACT_EMAIL_SQL = `
  NULLIF(LTRIM(RTRIM(c.email)), '')
`;

export const REQUESTER_EMAIL_SQL = `
  COALESCE(
    ${CASE_CONTACT_EMAIL_SQL},
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

/** @param {string} emailParam - nombre del parámetro SQL (p. ej. user_email, requester_email) */
export function buildRequesterOwnershipSql(emailParam) {
  return `
  (
    LOWER(LTRIM(RTRIM(${CASE_CONTACT_EMAIL_SQL}))) = LOWER(LTRIM(RTRIM(@${emailParam})))
    OR LOWER(LTRIM(RTRIM(${REQUESTER_EMAIL_SQL}))) = LOWER(LTRIM(RTRIM(@${emailParam})))
    OR EXISTS (
      SELECT 1 FROM [user] ux
      WHERE LOWER(LTRIM(RTRIM(ux.email))) = LOWER(LTRIM(RTRIM(@${emailParam})))
        AND (
          CAST(c.requester AS NVARCHAR(255)) = CAST(ux.id AS NVARCHAR(255))
          OR EXISTS (
            SELECT 1 FROM company_user cux
            WHERE cux.id_user = ux.id
              AND cux.id_company_user = TRY_CAST(c.requester AS INT)
          )
          OR (
            ${SUBJECT_REQUESTER_NAME_SQL} IS NOT NULL
            AND LTRIM(RTRIM(ux.name)) = LTRIM(RTRIM(${SUBJECT_REQUESTER_NAME_SQL}))
          )
        )
    )
  )
  `;
}

/** Condición: el caso pertenece a quien tiene ese correo (igualdad estricta, sin LIKE de nombre). */
export const REQUESTER_EMAIL_FILTER_SQL = buildRequesterOwnershipSql('requester_email');

/** Búsqueda libre por nombre, correo o referencia legacy */
export const REQUESTER_SEARCH_FILTER_SQL = `
  (
    ${CASE_CONTACT_EMAIL_SQL} LIKE '%' + @requester_search + '%'
    OR ${REQUESTER_NAME_SQL} LIKE '%' + @requester_search + '%'
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

/** Búsqueda del panel de tickets: ID, asunto, solicitante (nombre/correo). */
export const BOARD_CASE_SEARCH_SQL = `
  (
    CAST(c.id_case AS NVARCHAR(50)) LIKE '%' + @search + '%'
    OR c.subject_case LIKE '%' + @search + '%'
    OR ${CASE_CONTACT_EMAIL_SQL} LIKE '%' + @search + '%'
    OR ${REQUESTER_NAME_SQL} LIKE '%' + @search + '%'
    OR ${REQUESTER_EMAIL_SQL} LIKE '%' + @search + '%'
  )
`;

/**
 * Propiedad del caso por solicitante — verificación estricta (sin LIKE de nombre).
 * Usado en autorización (403) y listado "Mis tickets" para evitar IDOR.
 */
export const MY_TICKETS_USER_OWNERSHIP_SQL = buildRequesterOwnershipSql('user_email');

/** Casos asignados al usuario como técnico (id_technical). */
export const MY_TICKETS_ASSIGNED_TECHNICIAN_SQL = `
  EXISTS (
    SELECT 1
    FROM subprocess_user_company suc_me
    INNER JOIN company_user cu_me ON cu_me.id_company_user = suc_me.id_company_user
    INNER JOIN [user] u_me ON u_me.id = cu_me.id_user
    WHERE LOWER(LTRIM(RTRIM(u_me.email))) = LOWER(LTRIM(RTRIM(@user_email)))
      AND suc_me.id_subprocess_user_company = c.id_technical
  )
`;

/** Casos del usuario autenticado: como solicitante o como técnico asignado */
export const MY_TICKETS_SCOPE_SQL = `
  (
    ${MY_TICKETS_USER_OWNERSHIP_SQL}
    OR ${MY_TICKETS_ASSIGNED_TECHNICIAN_SQL}
  )
`;

/** Búsqueda por correo (u otro texto) dentro de mis tickets */
export const MY_TICKETS_EMAIL_SEARCH_SQL = `
  (
    LOWER(${CASE_CONTACT_EMAIL_SQL}) LIKE '%' + LOWER(LTRIM(RTRIM(@email_search))) + '%'
    OR LOWER(${REQUESTER_EMAIL_SQL}) LIKE '%' + LOWER(LTRIM(RTRIM(@email_search))) + '%'
    OR c.subject_case LIKE '%' + @email_search + '%'
    OR CAST(c.id_case AS NVARCHAR(50)) LIKE '%' + @email_search + '%'
    OR ${REQUESTER_NAME_SQL} LIKE '%' + @email_search + '%'
  )
`;
