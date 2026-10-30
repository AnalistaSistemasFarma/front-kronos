import { sqlLikeWords } from './textSearch';

/**
 * Filtro SQL del buscador libre de solicitudes (listados paginados en el servidor).
 * Cada palabra debe aparecer en id, asunto, empresa, categoría, proceso, estado, solicitante,
 * ejecutor o asignados del proceso, sin distinguir tildes ni mayúsculas.
 * Usa los alias de las consultas de solicitudes: rg, c, cr, pc, sc, u (solicitante), uex (ejecutor).
 * Los valores van como parámetros (@search0, @search1…), nunca dentro del texto SQL.
 */
export function requestSearchWhere(query: string | null | undefined): {
  clause: string;
  params: Array<[name: string, value: string]>;
} {
  const ai = 'COLLATE Latin1_General_CI_AI';
  const params: Array<[string, string]> = [];
  let clause = '';
  sqlLikeWords(query).forEach((pattern, i) => {
    const name = `search${i}`;
    const p = `@${name}`;
    clause += `
      AND (
        CAST(rg.id AS NVARCHAR(20)) LIKE ${p}
        OR rg.subject_request ${ai} LIKE ${p}
        OR c.company ${ai} LIKE ${p}
        OR cr.category ${ai} LIKE ${p}
        OR pc.process ${ai} LIKE ${p}
        OR sc.status ${ai} LIKE ${p}
        OR u.name ${ai} LIKE ${p}
        OR uex.name ${ai} LIKE ${p}
        OR EXISTS (
          SELECT 1
          FROM user_process_category_request_general ups
          INNER JOIN [user] us ON us.id = ups.id_user
          WHERE ups.id_process_category = pc.id AND us.name ${ai} LIKE ${p}
        )
      )`;
    params.push([name, pattern]);
  });
  return { clause, params };
}
