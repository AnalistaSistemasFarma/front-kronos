import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  permissionsForCopy,
  API_ACCESS_MODE_LABELS,
  normalizeApiAccessMode,
  normalizePermissionAccessKind,
  API_CLIENT_SELECTABLE_TYPES,
  clientTypeUsesApiAccess,
  defaultKeyValidityYears,
  isKeyExpired,
  keyValidityLabel,
  parseKeyValidityYears,
  API_SAP_MANAGE_SUBPROCESS_NAME,
  API_SAP_MANAGE_URL,
  API_SAP_PROCESS_NAME,
  isApiSapManageSubprocess,
} from './constants';
import {
  API_CLIENT_TYPES,
  API_CLIENT_TYPE_LABELS,
  API_KEY_PREFIX,
  LAST_USED_THROTTLE_MS,
  NOT_GRANTABLE_PERMISSIONS,
  PERMISSIONS_REQUIRING_AGENT_CODE,
  SYNERLINK_TOOL_PERMISSIONS,
  apiKeyVisiblePrefix,
  clientCoversCompany,
  extractBearerToken,
  findByKeyHash,
  generateApiKey,
  hashApiKey,
  isApiClientType,
  looksLikeApiKey,
  parseApiClientInput,
  parseRouteId,
  safeEqualHash,
  shouldTouchLastUsed,
} from './rules';

/** Catálogo ACTIVO (lo que valida el servidor): sin los permisos sembrados con active = 0. */
const KNOWN = new Set<string>(
  SYNERLINK_TOOL_PERMISSIONS.filter((c) => !(NOT_GRANTABLE_PERMISSIONS as readonly string[]).includes(c))
);

const validBody = () => ({
  name: '  Galileo   IA ',
  clientType: 'agente',
  description: ' Agente de pruebas ',
  agentCode: 'Galileo',
  allCompanies: false,
  companyIds: [3, 1, 3],
  permissionCodes: ['kronos_list_requests', 'kronos_get_request', 'kronos_list_requests'],
  active: true,
});

describe('llaves', () => {
  it('genera llaves sk_syn_ de 32 bytes aleatorios en base64url, distintas cada vez', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.key).toHaveLength(API_KEY_PREFIX.length + 43);
    expect(looksLikeApiKey(a.key)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.prefix).toBe(a.key.slice(0, API_KEY_PREFIX.length + 6));
    expect(a.prefix).toBe(apiKeyVisiblePrefix(a.key));
  });

  it('el hash es SHA-256 hex del texto exacto (determinista)', () => {
    const fixed = generateApiKey(() => Buffer.alloc(32, 7));
    expect(fixed.key).toBe(`sk_syn_${Buffer.alloc(32, 7).toString('base64url')}`);
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('looksLikeApiKey descarta basura', () => {
    expect(looksLikeApiKey(null)).toBe(false);
    expect(looksLikeApiKey('sk_syn_corta')).toBe(false);
    expect(looksLikeApiKey(`sk_xxx_${'a'.repeat(43)}`)).toBe(false);
    expect(looksLikeApiKey(`sk_syn_${'a'.repeat(42)}!`)).toBe(false);
  });

  it('safeEqualHash compara en tiempo constante y rechaza lo que no es hash', () => {
    const h = hashApiKey('x');
    expect(safeEqualHash(h, h)).toBe(true);
    expect(safeEqualHash(h, h.toUpperCase())).toBe(true);
    expect(safeEqualHash(h, hashApiKey('y'))).toBe(false);
    expect(safeEqualHash(h, 'abc')).toBe(false);
  });

  it('findByKeyHash recorre todos los candidatos y devuelve el que coincide', () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    const list = [{ id: 1, keyHash: k1.hash }, { id: 2, keyHash: k2.hash }];
    expect(findByKeyHash(k2.key, list)?.id).toBe(2);
    expect(findByKeyHash('otra', list)).toBeNull();
    expect(findByKeyHash(null, list)).toBeNull();
  });

  it('extractBearerToken', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer  abc ')).toBe('abc');
    expect(extractBearerToken('abc')).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it('last_used_at como máximo una vez por minuto', () => {
    expect(shouldTouchLastUsed(undefined, 1000)).toBe(true);
    expect(shouldTouchLastUsed(1000, 1000 + LAST_USED_THROTTLE_MS - 1)).toBe(false);
    expect(shouldTouchLastUsed(1000, 1000 + LAST_USED_THROTTLE_MS)).toBe(true);
  });
});

describe('parseApiClientInput', () => {
  it('normaliza un cuerpo válido', () => {
    const r = parseApiClientInput(validBody(), KNOWN);
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Galileo IA',
        clientType: 'agente',
        description: 'Agente de pruebas',
        agentCode: 'galileo',
        allCompanies: false,
        companyIds: [1, 3],
        permissionCodes: ['kronos_get_request', 'kronos_list_requests'],
        active: true,
        subjectRef: null,
        subjectLabel: null,
        accessMode: 'lectura',
        permissionCompanies: {},
      },
    });
  });

  it('acepta los 5 tipos, incluido «SynerLink» (sin agente obligatorio)', () => {
    expect(API_CLIENT_TYPES).toEqual(['agente', 'mexico', 'portal_terceros', 'synerlink', 'otro']);
    for (const clientType of API_CLIENT_TYPES) expect(API_CLIENT_TYPE_LABELS[clientType]).toBeTruthy();
    const r = parseApiClientInput(
      {
        ...validBody(),
        name: 'Orion',
        clientType: 'synerlink',
        agentCode: null,
        subjectRef: 'clx123abc',
        permissionCodes: ['kronos_get_request'],
      },
      KNOWN
    );
    expect(r.ok && r.value.clientType).toBe('synerlink');
    expect(isApiClientType('synerlink')).toBe(true);
    expect(isApiClientType('SynerLink')).toBe(false);
  });

  it('con «todas las empresas» descarta la lista', () => {
    const r = parseApiClientInput({ ...validBody(), allCompanies: true, companyIds: [] }, KNOWN);
    expect(r.ok && r.value.companyIds).toEqual([]);
  });

  it('«Proveedor o cliente» no exige empresas (solo se administra su portal)', () => {
    const r = parseApiClientInput(
      {
        ...validBody(),
        name: 'MAKRO OFFICE LTDA',
        clientType: 'portal_terceros',
        agentCode: null,
        subjectRef: '830010792',
        companyIds: [],
        permissionCodes: [],
      },
      KNOWN
    );
    expect(r.ok && r.value.companyIds).toEqual([]);
    expect(clientTypeUsesApiAccess('portal_terceros')).toBe(false);
    expect(clientTypeUsesApiAccess('mexico')).toBe(true);
    expect(API_CLIENT_SELECTABLE_TYPES).not.toContain('synerlink');
  });

  it('«Proveedor o cliente» nunca guarda permisos de API aunque lleguen en el cuerpo', () => {
    const r = parseApiClientInput(
      {
        ...validBody(),
        name: 'MAKRO OFFICE LTDA',
        clientType: 'portal_terceros',
        agentCode: null,
        subjectRef: '830010792',
        companyIds: [],
        permissionCodes: ['kronos_get_request'],
      },
      KNOWN
    );
    expect(r.ok && r.value.permissionCodes).toEqual([]);
  });

  it.each([
    ['campo desconocido', { extra: 1 }],
    ['nombre corto', { name: 'ab' }],
    ['tipo inválido', { clientType: 'admin' }],
    ['sin empresas ni todas', { companyIds: [] }],
    ['empresa no entera', { companyIds: [1.5] }],
    ['empresa negativa', { companyIds: [-1] }],
    ['permiso fuera del catálogo', { permissionCodes: ['kronos_usuarios_crear'] }],
    ['permisos no arreglo', { permissionCodes: 'kronos_get_request' }],
    ['activo no booleano', { active: 'true' }],
    ['allCompanies no booleano', { allCompanies: 1 }],
    ['código de agente con espacios', { agentCode: 'mi agente' }],
    ['descripción larga', { description: 'x'.repeat(501) }],
    ['ia_access sin código de agente', { agentCode: null, permissionCodes: ['kronos_request_ia_access'] }],
    ['proyectos sin código de agente', { clientType: 'otro', agentCode: null, permissionCodes: ['proyectos_listar'] }],
    ['correo sin código de agente', { clientType: 'otro', agentCode: null, permissionCodes: ['correo_hilo_compartido'] }],
    ['usuarios (inactivo, no se puede otorgar)', { permissionCodes: ['kronos_usuarios_consultar'] }],
  ])('rechaza: %s', (_name, patch) => {
    const r = parseApiClientInput({ ...validBody(), ...patch }, KNOWN);
    expect(r.ok).toBe(false);
  });

  it('rechaza cuerpos que no son objeto', () => {
    expect(parseApiClientInput(null, KNOWN).ok).toBe(false);
    expect(parseApiClientInput([], KNOWN).ok).toBe(false);
    expect(parseApiClientInput('x', KNOWN).ok).toBe(false);
  });

  it('acepta ia_access con código de agente', () => {
    const r = parseApiClientInput({ ...validBody(), permissionCodes: ['kronos_request_ia_access'] }, KNOWN);
    expect(r.ok).toBe(true);
  });

  it('acepta proyectos, correo, bitácora y Teams con código de agente', () => {
    const r = parseApiClientInput(
      { ...validBody(), permissionCodes: ['proyecto_detalle', 'correo_agregar_nota', 'kronos_get_bitacora', 'teams_list_meetings'] },
      KNOWN
    );
    expect(r.ok).toBe(true);
  });

  it('bitácora y Teams no exigen código de agente', () => {
    const r = parseApiClientInput(
      {
        ...validBody(),
        clientType: 'otro',
        agentCode: null,
        subjectRef: '4',
        permissionCodes: ['kronos_list_bitacoras', 'teams_get_transcript'],
      },
      KNOWN
    );
    expect(r.ok).toBe(true);
  });

  describe('sujeto según el tipo', () => {
    const body = (patch: Record<string, unknown>) => ({ ...validBody(), agentCode: null, permissionCodes: [], ...patch });

    it.each([
      ['portal_terceros', ' 901724736 ', '901724736'],
      ['synerlink', 'clx9abc_def-1', 'clx9abc_def-1'],
      ['otro', '12', '12'],
    ])('%s acepta su sujeto y lo normaliza', (clientType, subjectRef, expected) => {
      const r = parseApiClientInput(body({ clientType, subjectRef }), KNOWN);
      expect(r.ok && r.value.subjectRef).toBe(expected);
      // El nombre visible lo pone el servidor, nunca el cuerpo.
      expect(r.ok && r.value.subjectLabel).toBeNull();
    });

    it.each([
      ['portal_terceros', 'Elige el proveedor o cliente'],
      ['synerlink', 'Elige el usuario de SynerLink'],
      ['otro', 'Elige el sistema'],
    ])('%s exige el sujeto', (clientType, error) => {
      expect(parseApiClientInput(body({ clientType }), KNOWN)).toEqual({ ok: false, error });
      expect(parseApiClientInput(body({ clientType, subjectRef: '  ' }), KNOWN)).toEqual({ ok: false, error });
    });

    it.each([
      ['NIT con letras', 'portal_terceros', '90172A736'],
      ['NIT con puntos', 'portal_terceros', '901.724.736'],
      ['NIT corto', 'portal_terceros', '1234'],
      ['NIT largo', 'portal_terceros', '1234567890123456'],
      ['NIT número', 'portal_terceros', 901724736],
      ['usuario con espacios', 'synerlink', 'abc def'],
      ['usuario con comillas', 'synerlink', "x'; DROP TABLE user;--"],
      ['sistema cero', 'otro', '0'],
      ['sistema no numérico', 'otro', 'n8n'],
      ['sistema negativo', 'otro', '-3'],
    ])('rechaza %s', (_name, clientType, subjectRef) => {
      expect(parseApiClientInput(body({ clientType, subjectRef }), KNOWN).ok).toBe(false);
    });

    it('agente no usa sujeto (lo rechaza si viene)', () => {
      expect(parseApiClientInput({ ...validBody(), subjectRef: '901724736' }, KNOWN)).toEqual({
        ok: false,
        error: 'Este tipo de cliente no usa sujeto',
      });
    });

    it('México exige la persona por su correo y lo guarda en minúsculas', () => {
      const mexico = parseApiClientInput(body({ clientType: 'mexico', subjectRef: ' Ana.Lopez@GSS.mx ' }), KNOWN);
      expect(mexico.ok && mexico.value.subjectRef).toBe('ana.lopez@gss.mx');
      expect(parseApiClientInput(body({ clientType: 'mexico', subjectRef: null }), KNOWN)).toEqual({
        ok: false,
        error: 'Agrega la persona de México (nombre y correo)',
      });
      for (const bad of ['5', 'ana@', 'ana lopez@gss.mx', '@gss.mx', 'ana@gss']) {
        expect(parseApiClientInput(body({ clientType: 'mexico', subjectRef: bad }), KNOWN).ok).toBe(false);
      }
    });

    it('no acepta subjectLabel en el cuerpo (lo pone el servidor)', () => {
      expect(parseApiClientInput(body({ clientType: 'otro', subjectRef: '1', subjectLabel: 'Falso' }), KNOWN).ok).toBe(false);
    });
  });
});

describe('utilidades', () => {
  it('parseRouteId', () => {
    expect(parseRouteId('12')).toBe(12);
    expect(parseRouteId('0')).toBeNull();
    expect(parseRouteId('1e3')).toBeNull();
    expect(parseRouteId('-1')).toBeNull();
    expect(parseRouteId(undefined)).toBeNull();
  });

  it('clientCoversCompany', () => {
    expect(clientCoversCompany({ allCompanies: true, companyIds: [] }, 9)).toBe(true);
    expect(clientCoversCompany({ allCompanies: false, companyIds: [1, 2] }, 2)).toBe(true);
    expect(clientCoversCompany({ allCompanies: false, companyIds: [1, 2] }, 3)).toBe(false);
  });
});

describe('catálogo y scripts SQL', () => {
  const read = (name: string) => readFileSync(new URL(`../../prisma/manual/${name}`, import.meta.url), 'utf8');
  const pruebas = read('2026-11-09-permisos-api-PRUEBAS.sql');
  const prod = read('2026-11-09-permisos-api-PROD.sql');
  /** Filas de la semilla: (N'código', N'grupo', N'etiqueta', N'descripción', activo, orden). */
  const seedRows = (text: string) =>
    [...text.matchAll(/^\s*\(N'([a-z_]+)',.*, ([01]), (\d+)\),?\s*$/gm)].map((m) => ({
      code: m[1] as string,
      active: m[2] === '1',
      order: Number(m[3]),
    }));
  const seeded = (text: string) => seedRows(text).map((r) => r.code).sort();

  it('la semilla trae exactamente las 53 herramientas del catálogo', () => {
    expect(SYNERLINK_TOOL_PERMISSIONS).toHaveLength(53);
    expect(new Set(SYNERLINK_TOOL_PERMISSIONS).size).toBe(53);
    expect(seeded(pruebas)).toEqual([...SYNERLINK_TOOL_PERMISSIONS].sort());
    expect(seeded(prod)).toEqual(seeded(pruebas));
  });

  it('solo las de Usuarios entran inactivas y el orden no se repite', () => {
    const rows = seedRows(pruebas);
    expect(rows.filter((r) => !r.active).map((r) => r.code).sort()).toEqual([...NOT_GRANTABLE_PERMISSIONS].sort());
    expect(new Set(rows.map((r) => r.order)).size).toBe(rows.length);
  });

  it('los que exigen código de agente están en el catálogo', () => {
    for (const code of PERMISSIONS_REQUIRING_AGENT_CODE) expect(SYNERLINK_TOOL_PERMISSIONS).toContain(code);
  });

  it('cada permiso del catálogo existe como herramienta en el MCP', () => {
    const files = ['index.ts', 'iaAccess.ts', 'bitacoraProceso.ts', 'proyectos.ts', 'correoAgente.ts', 'usuarios.ts'];
    const tools = files.map((f) => readFileSync(new URL(`../../mcp/src/tools/${f}`, import.meta.url), 'utf8')).join('\n');
    for (const code of SYNERLINK_TOOL_PERMISSIONS) {
      expect(tools).toContain(`'${code}'`);
    }
  });

  it('PROD y PRUEBAS solo difieren en la base esperada y el encabezado', () => {
    const strip = (t: string) =>
      t
        .replace(/\/\*[\s\S]*?\*\//, '')
        .replace(/IF DB_NAME\(\)[^\n]*\n[^\n]*\n/, '');
    expect(strip(prod)).toBe(strip(pruebas));
  });

  /** Tipos del CHECK api_client_client_type_ck de un script. */
  const checkTypes = (text: string) => {
    const m = text.match(/\[api_client_client_type_ck\]\s*CHECK \(\[client_type\] IN \(([^)]*)\)\)/);
    return m ? [...(m[1] as string).matchAll(/N'([a-z_]+)'/g)].map((x) => x[1]).sort() : null;
  };
  const tipoPruebas = read('2026-11-09-permisos-api-tipo-synerlink-PRUEBAS.sql');
  const tipoProd = read('2026-11-09-permisos-api-tipo-synerlink-PROD.sql');

  it('el CHECK de tipos (script principal y el del tipo SynerLink) trae exactamente API_CLIENT_TYPES', () => {
    const expected = [...API_CLIENT_TYPES].sort();
    for (const text of [pruebas, prod, tipoPruebas, tipoProd]) expect(checkTypes(text)).toEqual(expected);
  });

  it('el script del tipo SynerLink es idempotente y protege la base', () => {
    expect(tipoPruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(tipoProd).toMatch(/IF DB_NAME\(\) <> N'KRONOSDB'/);
    for (const text of [tipoPruebas, tipoProd]) {
      expect(text).toMatch(/IF NOT EXISTS \([\s\S]*definition LIKE N'%synerlink%'/);
      expect(text).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP TABLE|TRUNCATE)\b/i);
    }
    const strip = (t: string) =>
      t
        .replace(/\/\*[\s\S]*?\*\//, '')
        .replace(/IF DB_NAME\(\)[^\n]*\n[^\n]*\n/, '');
    expect(strip(tipoProd)).toBe(strip(tipoPruebas));
  });

  const sujetosPruebas = read('2026-11-09-permisos-api-sujetos-PRUEBAS.sql');
  const sujetosProd = read('2026-11-09-permisos-api-sujetos-PROD.sql');

  it('el script de sujetos es idempotente, protege la base y PROD solo difiere en la base', () => {
    expect(sujetosPruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(sujetosProd).toMatch(/IF DB_NAME\(\) <> N'KRONOSDB'/);
    for (const text of [sujetosPruebas, sujetosProd]) {
      expect(text).toMatch(/IF COL_LENGTH\(N'dbo\.api_client', N'subject_ref'\) IS NULL\s+ALTER TABLE \[dbo\]\.\[api_client\] ADD \[subject_ref\] NVARCHAR\(120\) NULL;/);
      expect(text).toMatch(/IF COL_LENGTH\(N'dbo\.api_client', N'subject_label'\) IS NULL\s+ALTER TABLE \[dbo\]\.\[api_client\] ADD \[subject_label\] NVARCHAR\(200\) NULL;/);
      expect(text).toMatch(/IF OBJECT_ID\(N'dbo\.api_external_system', N'U'\) IS NULL/);
      expect(text).toMatch(/CONSTRAINT \[api_external_system_name_key\] UNIQUE/);
      expect(text).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM \[dbo\]\.\[api_external_system\]/);
      expect(text).not.toMatch(/\b(UPDATE|DELETE|DROP TABLE|TRUNCATE)\b/i);
    }
    const strip = (t: string) =>
      t
        .replace(/\/\*[\s\S]*?\*\//, '')
        .replace(/IF DB_NAME\(\)[^\n]*\n[^\n]*\n/, '');
    expect(strip(sujetosProd)).toBe(strip(sujetosPruebas));
  });

  it('los scripts principales ya traen los sujetos para instalaciones nuevas', () => {
    for (const text of [pruebas, prod]) {
      expect(text).toMatch(/\[subject_ref\] NVARCHAR\(120\) NULL,/);
      expect(text).toMatch(/\[subject_label\] NVARCHAR\(200\) NULL,/);
      expect(text).toMatch(/CREATE TABLE \[dbo\]\.\[api_external_system\]/);
    }
    expect(read('2026-11-09-permisos-api-reversa.sql')).toMatch(/DROP TABLE \[dbo\]\.\[api_external_system\]/);
  });
});

describe('vencimiento de llaves (2026-11-10)', () => {
  it('vigencia: ausente = no vence; solo años de la lista', () => {
    expect(parseKeyValidityYears(undefined)).toBe(0);
    expect(parseKeyValidityYears(2)).toBe(2);
    expect(parseKeyValidityYears(5)).toBe(5);
    for (const bad of [4, -1, '2', 2.5, null, 10]) expect(parseKeyValidityYears(bad)).toBeNull();
  });

  it('México sugiere 2 años; los demás, no vence', () => {
    expect(defaultKeyValidityYears('mexico')).toBe(2);
    expect(defaultKeyValidityYears('agente')).toBe(0);
    expect(keyValidityLabel(0)).toBe('No vence');
    expect(keyValidityLabel(1)).toBe('1 año');
    expect(keyValidityLabel(3)).toBe('3 años');
  });

  it('isKeyExpired: sin fecha no vence; fecha pasada o igual, vencida', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(isKeyExpired(null, now)).toBe(false);
    expect(isKeyExpired('2028-11-10T12:00:00Z', now)).toBe(false);
    expect(isKeyExpired('2026-11-10T12:00:00Z', now)).toBe(true);
    expect(isKeyExpired(new Date('2026-01-01T00:00:00Z'), now)).toBe(true);
  });
});

describe('permiso «Gestión de la API SAP» (2026-11-10)', () => {
  const read = (name: string) => readFileSync(new URL(`../../prisma/manual/${name}`, import.meta.url), 'utf8');

  it('reconoce el subproceso por su URL (sin importar mayúsculas ni barra final)', () => {
    expect(isApiSapManageSubprocess({ subprocess_url: API_SAP_MANAGE_URL })).toBe(true);
    expect(isApiSapManageSubprocess({ subprocess_url: ' /Process/API-SAP/ ' })).toBe(true);
    expect(isApiSapManageSubprocess({ subprocess_url: '/process/api-sap/otra' })).toBe(false);
    expect(isApiSapManageSubprocess({ subprocess_url: null })).toBe(false);
  });

  it('los scripts crean el mismo proceso, subproceso y URL que usa el código', () => {
    for (const env of ['PRUEBAS', 'PROD']) {
      const text = read(`2026-11-10-permisos-api-gestion-api-sap-${env}.sql`);
      expect(text).toContain(`N'${API_SAP_MANAGE_URL}'`);
      expect(text).toContain(`N'${API_SAP_PROCESS_NAME}'`);
      expect(text).toContain(`N'${API_SAP_MANAGE_SUBPROCESS_NAME}'`);
      // No se lo asigna a nadie: se asigna desde la pantalla como cualquier subproceso.
      expect(text).not.toMatch(/INSERT INTO \[dbo\]\.\[subprocess_user_company\]/);
    }
    expect(read('2026-11-10-permisos-api-gestion-api-sap-PRUEBAS.sql')).not.toMatch(/NOT IN \(N'KRONOSDB'\)/);
  });
});

describe('nivel de acceso: solo lectura / lectura y escritura (2026-11-11)', () => {
  it('por defecto (ausente o null) es solo lectura', () => {
    for (const accessMode of [undefined, null]) {
      const r = parseApiClientInput({ ...validBody(), accessMode }, KNOWN);
      expect(r.ok && r.value.accessMode).toBe('lectura');
    }
  });

  it('acepta escritura en todos los tipos, también proveedores y México', () => {
    const r = parseApiClientInput({ ...validBody(), accessMode: 'escritura' }, KNOWN);
    expect(r.ok && r.value.accessMode).toBe('escritura');
  });

  it('rechaza un nivel desconocido', () => {
    for (const accessMode of ['admin', 'ESCRITURA', 1, true]) {
      const r = parseApiClientInput({ ...validBody(), accessMode }, KNOWN);
      expect(r).toEqual({ ok: false, error: 'Nivel de acceso no válido' });
    }
  });

  it('normaliza lo que viene de la base: NULL o cualquier valor raro = lectura / consulta', () => {
    expect(normalizeApiAccessMode(null)).toBe('lectura');
    expect(normalizeApiAccessMode('administracion')).toBe('lectura');
    expect(normalizeApiAccessMode('escritura')).toBe('escritura');
    expect(normalizePermissionAccessKind(null)).toBe('consulta');
    expect(normalizePermissionAccessKind('escritura')).toBe('escritura');
    expect(API_ACCESS_MODE_LABELS).toEqual({ lectura: 'Solo lectura', escritura: 'Lectura y escritura' });
  });

  it('los scripts: PROD igual a PRUEBAS salvo la base, protegen la base y quitan la prueba portal_mode', () => {
    const read = (name: string) => readFileSync(`prisma/manual/${name}`, 'utf8');
    const pruebas = read('2026-11-11-permisos-api-nivel-acceso-PRUEBAS.sql');
    const prod = read('2026-11-11-permisos-api-nivel-acceso-PROD.sql');
    const reversa = read('2026-11-11-permisos-api-nivel-acceso-reversa.sql');
    expect(pruebas).toContain("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    expect(prod).toContain("IF DB_NAME() NOT IN (N'KRONOSDB')");
    for (const text of [pruebas, prod]) {
      expect(text).toContain('ADD [access_mode] NVARCHAR(20) NULL');
      expect(text).toContain('ADD [access_kind] NVARCHAR(20) NOT NULL');
      expect(text).toContain('DROP COLUMN [portal_mode]');
      expect(text).not.toContain('DELETE FROM');
    }
    expect(reversa).toContain('DROP COLUMN [access_mode]');
    expect(reversa).toContain('DROP COLUMN [access_kind]');
  });
});

describe('copiar permisos a otros clientes (2026-11-11)', () => {
  const WRITE = new Set(['kronos_create_request', 'kronos_add_note']);
  const codes = ['kronos_list_requests', 'kronos_create_request', 'proyectos_listar', 'sap_facturas', 'kronos_add_note'];

  it('con escritura y agente recibe todo, ordenado y sin repetidos', () => {
    const r = permissionsForCopy([...codes, 'sap_facturas'], { clientType: 'agente', accessMode: 'escritura', agentCode: 'zoe' }, WRITE);
    expect(r.codes).toEqual([...codes].sort());
    expect(r.droppedWrite).toEqual([]);
    expect(r.droppedAgent).toEqual([]);
  });

  it('en solo lectura no recibe los de escritura', () => {
    const r = permissionsForCopy(codes, { clientType: 'agente', accessMode: 'lectura', agentCode: 'zoe' }, WRITE);
    expect(r.droppedWrite.sort()).toEqual(['kronos_add_note', 'kronos_create_request']);
    expect(r.codes).toEqual(['kronos_list_requests', 'proyectos_listar', 'sap_facturas']);
  });

  it('una persona de México sin agente no recibe los que exigen agente', () => {
    const r = permissionsForCopy(codes, { clientType: 'mexico', accessMode: 'lectura', agentCode: null }, WRITE);
    expect(r.droppedAgent).toEqual(['proyectos_listar']);
    expect(r.codes).toEqual(['kronos_list_requests', 'sap_facturas']);
  });

  it('un proveedor o cliente no recibe permisos de API', () => {
    const r = permissionsForCopy(codes, { clientType: 'portal_terceros', accessMode: 'escritura', agentCode: null }, WRITE);
    expect(r).toEqual({ codes: [], droppedWrite: [], droppedAgent: [] });
  });
});

describe('catálogo «SAP» (2026-11-11)', () => {
  const read = (name: string) => readFileSync(`prisma/manual/${name}`, 'utf8');

  it('agrega 20 permisos de consulta de la API SAP, iguales en PRUEBAS y PROD', () => {
    const codesOf = (text: string) => [...text.matchAll(/N''(sap_[a-z_]+)''/g)].map((m) => m[1]).sort();
    const pruebas = read('2026-11-11-permisos-api-catalogo-sap-PRUEBAS.sql');
    const prod = read('2026-11-11-permisos-api-catalogo-sap-PROD.sql');
    expect(codesOf(pruebas)).toHaveLength(20);
    expect(codesOf(prod)).toEqual(codesOf(pruebas));
    expect(pruebas).toContain("N''sap''");
    expect(pruebas).toContain("N''consulta''");
    expect(pruebas).toContain('WHERE NOT EXISTS');
    expect(pruebas).toContain("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    expect(prod).toContain("IF DB_NAME() NOT IN (N'KRONOSDB')");
    expect(pruebas).not.toContain('DELETE');
  });

  it('la reversa solo quita lo de SAP', () => {
    const reversa = read('2026-11-11-permisos-api-catalogo-sap-reversa.sql');
    expect(reversa).toContain("WHERE [system] = N'sap'");
    expect(reversa).toContain("WHERE p.[system] = N'sap'");
  });
});

describe('permisos por empresa (2026-11-11)', () => {
  // validBody(): empresas [1, 3] y permisos kronos_get_request + kronos_list_requests.
  it('sin el campo, cada permiso vale en todas las empresas del cliente', () => {
    const r = parseApiClientInput(validBody(), KNOWN);
    expect(r.ok && r.value.permissionCompanies).toEqual({});
  });

  it('guarda empresas por permiso, ordenadas y sin repetir', () => {
    const r = parseApiClientInput({ ...validBody(), permissionCompanies: { kronos_get_request: [3, 1, 3] } }, KNOWN);
    expect(r.ok && r.value.permissionCompanies).toEqual({ kronos_get_request: [1, 3] });
  });

  it('una lista vacía = todas (no se guarda)', () => {
    const r = parseApiClientInput({ ...validBody(), permissionCompanies: { kronos_get_request: [] } }, KNOWN);
    expect(r.ok && r.value.permissionCompanies).toEqual({});
  });

  it('rechaza una empresa que el cliente no tiene', () => {
    const r = parseApiClientInput({ ...validBody(), permissionCompanies: { kronos_get_request: [2] } }, KNOWN);
    expect(r).toEqual({ ok: false, error: 'Un permiso tiene una empresa que este cliente no tiene marcada' });
  });

  it('con «Todas las empresas» acepta cualquier empresa (el servidor revisa que exista)', () => {
    const r = parseApiClientInput(
      { ...validBody(), allCompanies: true, companyIds: [], permissionCompanies: { kronos_get_request: [7] } },
      KNOWN
    );
    expect(r.ok && r.value.permissionCompanies).toEqual({ kronos_get_request: [7] });
  });

  it('rechaza permisos no marcados, formatos raros e ids no válidos', () => {
    for (const permissionCompanies of [
      { kronos_add_note: [1] },
      [1, 3],
      'x',
      { kronos_get_request: 'x' },
      { kronos_get_request: [0] },
      { kronos_get_request: [1.5] },
    ]) {
      expect(parseApiClientInput({ ...validBody(), permissionCompanies }, KNOWN).ok).toBe(false);
    }
  });

  it('el script crea la tabla con borrado en cascada y la reversa la quita', () => {
    const read = (name: string) => readFileSync(`prisma/manual/${name}`, 'utf8');
    const pruebas = read('2026-11-11-permisos-api-permiso-empresa-PRUEBAS.sql');
    const prod = read('2026-11-11-permisos-api-permiso-empresa-PROD.sql');
    for (const text of [pruebas, prod]) {
      expect(text).toContain('CREATE TABLE [dbo].[api_client_permission_company]');
      expect(text).toContain('ON DELETE CASCADE');
      expect(text).not.toContain('DELETE FROM');
    }
    expect(pruebas).toContain("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    expect(prod).toContain("IF DB_NAME() NOT IN (N'KRONOSDB')");
    expect(read('2026-11-11-permisos-api-permiso-empresa-reversa.sql')).toContain('DROP TABLE [dbo].[api_client_permission_company]');
  });
});
