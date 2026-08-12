import { describe, it, expect } from 'vitest';
import { TECHNICIAN_PERSON_FILTER_SQL } from '../requesterSql';

// El dropdown "Técnico asignado" envía UN id_subprocess_user_company, pero una
// persona puede tener varias filas en subprocess_user_company (por empresa o
// subproceso) y sus casos quedar repartidos entre ellas. El filtro debe resolver
// la PERSONA (id_user) y traer los casos de TODOS sus id_subprocess_user_company,
// no solo el id que envió el dropdown.

describe('TECHNICIAN_PERSON_FILTER_SQL', () => {
  const sql = TECHNICIAN_PERSON_FILTER_SQL.replace(/\s+/g, ' ').trim();

  it('filtra por c.id_technical con un IN (…) en vez de igualdad a un solo id', () => {
    expect(sql).toMatch(/c\.id_technical\s+IN\s*\(/i);
    expect(sql).not.toMatch(/c\.id_technical\s*=\s*@technician/i);
  });

  it('mantiene @technician como único parámetro de entrada', () => {
    const params = sql.match(/@\w+/g) ?? [];
    expect([...new Set(params)]).toEqual(['@technician']);
  });

  it('resuelve la persona (id_user) del @technician recibido', () => {
    // Subconsulta interna: del @technician saca su id_user…
    expect(sql).toMatch(/WHERE\s+ss\.id_subprocess_user_company\s*=\s*@technician/i);
    // …y con ese id_user recolecta todos sus id_subprocess_user_company.
    expect(sql).toMatch(/ca\.id_user\s*=\s*\(/i);
    expect(sql).toMatch(/SELECT\s+sa\.id_subprocess_user_company/i);
  });

  it('recorre subprocess_user_company vía company_user (todas las empresas de la persona)', () => {
    expect(sql).toMatch(/subprocess_user_company/i);
    expect(sql).toMatch(/company_user/i);
  });
});
