import { describe, expect, it } from 'vitest';
import {
  agruparPorProductoRyan,
  canalDeSemilla,
  canalSugerido,
  companyVitrinaAccess,
  datosFaltantes,
  elegirRegistro,
  esVendible,
  estadoExclusividad,
  estadoRegistro,
  familiaDeSemilla,
  familiaSugerida,
  filtroItemsSap,
  fuenteDeEmpresa,
  marcaDeTipo,
  motivosNoCliente,
  parseCodigoRyan,
  parsePresentacionSugerida,
  parseSemilla,
  resolveVitrinaAccess,
  semillaDeEmpresa,
  validarVigencia,
  visibilidadEfectiva,
  visibilidadPermitida,
  VitrinaError,
  type VisibilidadInput,
} from '../rules';
import { vitrinaPermissionFromUrl } from '../constants';

const FARMA = fuenteDeEmpresa(1)!;
const RYAN = fuenteDeEmpresa(2)!;
const HOY = '2026-10-22';

describe('Vitrina · acceso por empresa (subprocess_user_company)', () => {
  it('reconoce solo las dos URLs del módulo', () => {
    expect(vitrinaPermissionFromUrl('/process/vitrina')).toBe('consulta');
    expect(vitrinaPermissionFromUrl('/process/vitrina/gestion/')).toBe('gestion');
    expect(vitrinaPermissionFromUrl('/process/articles')).toBeNull();
  });

  it('Gestión implica consulta, y cada empresa va por separado', () => {
    const access = resolveVitrinaAccess([
      { subprocessUrl: '/process/vitrina/gestion', idCompany: 1, companyName: 'FARMALOGICA S.A.' },
      { subprocessUrl: '/process/vitrina', idCompany: 2, companyName: 'LABORATORIOS RYAN' },
      { subprocessUrl: '/process/health-records', idCompany: 3, companyName: 'OLP' },
    ]);
    expect(access).toEqual([
      { idCompany: 1, companyName: 'FARMALOGICA S.A.', canConsultar: true, canGestionar: true },
      { idCompany: 2, companyName: 'LABORATORIOS RYAN', canConsultar: true, canGestionar: false },
    ]);
    expect(companyVitrinaAccess(access, 1, 'canGestionar')).not.toBeNull();
    expect(companyVitrinaAccess(access, 2, 'canGestionar')).toBeNull();
    expect(companyVitrinaAccess(access, 3, 'canConsultar')).toBeNull();
  });
});

describe('Vitrina · fuente SAP por empresa', () => {
  it('Farmalógica lee PT y Ryan lee 301', () => {
    expect(filtroItemsSap(FARMA)).toBe("startswith(ItemCode,'PT')");
    expect(filtroItemsSap(RYAN)).toBe("startswith(ItemCode,'301')");
    expect(fuenteDeEmpresa(3)).toBeNull();
  });

  it('vendible = SalesItem tYES, Valid tYES, Frozen tNO y con el prefijo', () => {
    const ok = { ItemCode: 'PTMP0111', SalesItem: 'tYES', Valid: 'tYES', Frozen: 'tNO' };
    expect(esVendible(ok, FARMA)).toBe(true);
    expect(esVendible({ ...ok, Frozen: 'tYES' }, FARMA)).toBe(false);
    expect(esVendible({ ...ok, Valid: 'tNO' }, FARMA)).toBe(false);
    expect(esVendible({ ...ok, SalesItem: 'tNO' }, FARMA)).toBe(false);
    expect(esVendible(ok, RYAN)).toBe(false);
    expect(esVendible({ ...ok, ItemCode: '301010036' }, RYAN)).toBe(true);
  });
});

describe('Vitrina · registro sanitario', () => {
  const reg = (vence: string, obsoleto = 'NO', numero = 'INVIMA 2020M-1') => ({ U_Referencia: 'PTMP0111', U_Registro_Sanitario: numero, U_Fecha_Vencimiento: `${vence}T00:00:00Z`, U_Obsoleto: obsoleto });

  it('sin registro activo → SIN_REGISTRO', () => {
    expect(estadoRegistro(null, HOY).estado).toBe('SIN_REGISTRO');
    expect(elegirRegistro([reg('2030-01-01', 'SI')])).toBeNull();
  });

  it('9999-01-01 significa sin dato, no vigente', () => {
    const e = estadoRegistro(reg('9999-01-01'), HOY);
    expect(e).toEqual({ estado: 'SIN_FECHA', numero: 'INVIMA 2020M-1', venceEn: null, dias: null });
  });

  it('vencido antes de hoy → VENCIDO; hoy mismo aún no vence', () => {
    expect(estadoRegistro(reg('2026-10-19'), HOY)).toMatchObject({ estado: 'VENCIDO', dias: -3, venceEn: '2026-10-19' });
    expect(estadoRegistro(reg(HOY), HOY).estado).toBe('POR_VENCER');
  });

  it('90 días o menos → POR_VENCER; 91 → VIGENTE', () => {
    expect(estadoRegistro(reg('2027-01-20'), HOY)).toMatchObject({ estado: 'POR_VENCER', dias: 90 });
    expect(estadoRegistro(reg('2027-01-21'), HOY)).toMatchObject({ estado: 'VIGENTE', dias: 91 });
  });

  it('toma solo los no obsoletos y prefiere la fecha real más lejana sobre 9999', () => {
    const elegido = elegirRegistro([reg('2031-01-01', 'SI', 'viejo'), reg('9999-01-01', 'NO', 'sin-fecha'), reg('2028-05-01', 'NO', 'real'), reg('2027-01-01', 'NO', 'anterior')]);
    expect(elegido?.U_Registro_Sanitario).toBe('real');
    expect(elegirRegistro([reg('9999-01-01', 'NO', 'solo-sin-fecha')])?.U_Registro_Sanitario).toBe('solo-sin-fecha');
  });
});

describe('Vitrina · visibilidad (terceros, canales, datos)', () => {
  const base = (): VisibilidadInput => ({
    presentacion: { molecula: 'Meropenem', concentracion: '1 g', forma_farmaceutica: 'Vial', familia: 'Carbapenémicos', estado: 'VALIDADA', visibilidad: 'OFERTABLE', es_para_terceros: false },
    codigo: { canal: 'SIN_DATO', visibilidad_canal: 'INTERNA', activado_vitrina: true, activo_en_sap: true, registro_estado: 'VIGENTE' },
  });

  it('terceros: visibilidad fija INTERNA (rechaza otra)', () => {
    expect(visibilidadPermitida('INTERNA', true)).toBe('INTERNA');
    expect(() => visibilidadPermitida('CLIENTE', true)).toThrow(VitrinaError);
    expect(() => visibilidadPermitida('OFERTABLE', true)).toThrow(/fija «Interna»/);
    expect(visibilidadPermitida('OFERTABLE', false)).toBe('OFERTABLE');
    expect(() => visibilidadPermitida('PUBLICA', false)).toThrow(/no válida/);
  });

  it('nada se muestra sin activación manual ni si SAP lo inactivó', () => {
    const i = base();
    expect(visibilidadEfectiva(i)).toBe('OFERTABLE');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, activado_vitrina: false } })).toBe('OCULTA');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, activo_en_sap: false } })).toBe('OCULTA');
    expect(visibilidadEfectiva({ ...i, presentacion: { ...i.presentacion, estado: 'RETIRADA' } })).toBe('OCULTA');
  });

  it('para terceros queda INTERNA aunque la fila diga otra cosa', () => {
    const i = base();
    expect(visibilidadEfectiva({ ...i, presentacion: { ...i.presentacion, es_para_terceros: true } })).toBe('INTERNA');
  });

  it('canal institucional/comercial empieza INTERNA y limita la visibilidad', () => {
    const i = base();
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, canal: 'INSTITUCIONAL' } })).toBe('INTERNA');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, canal: 'COMERCIAL', visibilidad_canal: 'CLIENTE' } })).toBe('CLIENTE');
    expect(visibilidadEfectiva({ ...i, presentacion: { ...i.presentacion, visibilidad: 'CLIENTE' }, codigo: { ...i.codigo, canal: 'COMERCIAL', visibilidad_canal: 'OFERTABLE' } })).toBe('CLIENTE');
  });

  it('pendiente, registro vencido o sin registro, o datos faltantes → como máximo INTERNA', () => {
    const i = base();
    expect(visibilidadEfectiva({ ...i, presentacion: { ...i.presentacion, estado: 'PENDIENTE' } })).toBe('INTERNA');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, registro_estado: 'VENCIDO' } })).toBe('INTERNA');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, registro_estado: 'SIN_REGISTRO' } })).toBe('INTERNA');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, registro_estado: 'POR_VENCER' } })).toBe('OFERTABLE');
    expect(visibilidadEfectiva({ ...i, codigo: { ...i.codigo, registro_estado: 'SIN_FECHA' } })).toBe('OFERTABLE');
    expect(visibilidadEfectiva({ ...i, presentacion: { ...i.presentacion, familia: null } })).toBe('INTERNA');
    expect(datosFaltantes({ molecula: 'X' })).toEqual(['concentración', 'forma farmacéutica', 'familia']);
  });

  it('explica por qué un código no llega al cliente', () => {
    const i = base();
    const m = motivosNoCliente({ presentacion: { ...i.presentacion, es_para_terceros: true, estado: 'PENDIENTE' }, codigo: { ...i.codigo, activado_vitrina: false, registro_estado: 'VENCIDO' } });
    expect(m).toEqual(['No está activado en la Vitrina', 'Presentación pendiente de validar', 'Producto para terceros (siempre interno)', 'Registro sanitario vencido']);
  });
});

describe('Vitrina · código de Ryan (301 + unidades + producto)', () => {
  it('descompone el código', () => {
    expect(parseCodigoRyan('301010036')).toEqual({ pais: '301', unidades: 10, producto: '036', sufijo: '', excepcion: false });
    expect(parseCodigoRyan('301001001')?.unidades).toBe(1);
    expect(parseCodigoRyan('301010085.')).toMatchObject({ producto: '085', sufijo: '.', excepcion: true });
    expect(parseCodigoRyan('301999012')).toMatchObject({ unidades: null, excepcion: true });
    expect(parseCodigoRyan('PTRY0039')).toBeNull();
    expect(parseCodigoRyan('302010036')).toBeNull();
  });

  it('agrupa por los 3 últimos dígitos y marca excepciones sin agrupar a ciegas', () => {
    const grupos = agruparPorProductoRyan([
      { item_code: '301001036' },
      { item_code: '301010036' },
      { item_code: '301100036' },
      { item_code: '301010001' },
      { item_code: '301010065' },
      { item_code: '301010065-LP' },
      { item_code: '3010100650' },
    ]);
    expect(grupos.map((g) => [g.producto, g.codigos.length])).toEqual([
      ['001', 1],
      ['036', 3],
      ['065', 3],
    ]);
    expect(grupos.find((g) => g.producto === '036')!.avisos).toEqual([]);
    const avisos065 = grupos.find((g) => g.producto === '065')!.avisos;
    expect(avisos065.some((a) => a.includes('«-LP»'))).toBe(true);
    expect(avisos065.some((a) => a.includes('«0»'))).toBe(true);
  });

  it('avisa de dos códigos con las mismas unidades (duplicado por país)', () => {
    const [g] = agruparPorProductoRyan([{ item_code: '301010076' }, { item_code: '301010076' }]);
    expect(g.avisos[0]).toMatch(/mismas unidades/);
  });
});

describe('Vitrina · sugerencias', () => {
  it('familia por grupo de Farmalógica; Ryan a mano', () => {
    expect(familiaSugerida(FARMA, 130)).toBe('Carbapenémicos');
    expect(familiaSugerida(FARMA, 100)).toBeNull();
    expect(familiaSugerida(RYAN, 130)).toBeNull();
  });

  it('canal: INST al final o «institucional» en el nombre', () => {
    expect(canalSugerido('PTMP0153INST', '')).toBe('INSTITUCIONAL');
    expect(canalSugerido('301100008', 'BICARBONATO DE SODIO 1mEq/mL Institucional (CAJA X 100)')).toBe('INSTITUCIONAL');
    expect(canalSugerido('PTMP0111', 'MEROPENEM')).toBe('SIN_DATO');
    expect(canalDeSemilla({ itemCode: 'PTCL0553C', itemName: null, tipo: 'Mexico comercial', observacion: null, pais: 'Mexico' })).toBe('COMERCIAL');
    expect(canalDeSemilla({ itemCode: 'PTRY0066', itemName: null, tipo: 'Ryan - canal comercial', observacion: null, pais: 'Colombia' })).toBe('COMERCIAL');
    expect(canalDeSemilla({ itemCode: 'PTRY0065', itemName: null, tipo: 'Ryan - canal institucional (mismo registro)', observacion: null, pais: 'Colombia' })).toBe('INSTITUCIONAL');
  });

  it('prellenado de la presentación', () => {
    expect(parsePresentacionSugerida('Aztreonam 1 g x10 - AZBIOS')).toEqual({ molecula: 'Aztreonam', concentracion: '1 g', unidades: 10, nombreComercial: 'AZBIOS' });
    expect(parsePresentacionSugerida('Piperacilina + Tazobactam 4,5 g x10')).toMatchObject({ molecula: 'Piperacilina + Tazobactam', concentracion: '4,5 g', unidades: 10 });
    expect(parsePresentacionSugerida('')).toBeNull();
  });
});

describe('Vitrina · semilla CSV', () => {
  it('lee la carga de Farmalógica: terceros, marca y familia', () => {
    const csv = [
      'Codigo SAP;Presentacion propuesta;Empresa;Familia (grupo SAP);Pais;Tipo;Visibilidad propuesta',
      'PTAB0110;Aztreonam 1 g x10 - AZBIOS;Farmalogica;Monobactamicos;Colombia;Para terceros (Bioselect);Interna',
      'PTAM0156;Ampicilina 1 g x10;Farmalogica;Penicilinas;Costa Rica;Para terceros (PISA, el codigo no lleva P);Interna',
      'PTRY0039;Vitamina C x10;Farmalogica (producto de Ryan);Por asignar;Colombia;Ryan - EXCLUSIVA OLP;Interna (exclusividad)',
      'PTAB0110;repetido;Farmalogica;Monobactamicos;Colombia;Propio;Interna',
    ].join('\r\n');
    const r = parseSemilla(csv);
    expect(r.formato).toBe('FARMALOGICA');
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0]).toMatchObject({ itemCode: 'PTAB0110', presentacion: 'Aztreonam 1 g x10 - AZBIOS', familia: 'Monobactámicos', esParaTerceros: true, clienteMarca: 'Bioselect' });
    expect(r.filas[1].clienteMarca).toBe('PISA');
    expect(r.filas[2]).toMatchObject({ familia: null, esParaTerceros: false });
    expect(r.errores).toEqual(['Fila 5: el código PTAB0110 está repetido; se toma la primera fila.']);
    expect(semillaDeEmpresa(r.formato, 1)).toBe(true);
    expect(semillaDeEmpresa(r.formato, 2)).toBe(false);
  });

  it('lee la carga de Ryan, con «;» dentro de la observación', () => {
    const csv = [
      'Codigo SAP Ryan;Nombre en SAP;Unidades (segun codigo);Producto (3 ultimos digitos);Pais;Observacion',
      '301001022;NALOXIV (NALOXONA 0,4 mg/mL) S.I (UND);1;022;Colombia;Unidad suelta; producto 022 coincide con hioscina',
      '301999012;X;999;012;Colombia;Sin unidades (999)',
    ].join('\n');
    const r = parseSemilla(csv);
    expect(r.formato).toBe('RYAN');
    expect(r.filas[0]).toMatchObject({ itemCode: '301001022', itemName: 'NALOXIV (NALOXONA 0,4 mg/mL) S.I (UND)', unidades: 1, observacion: 'Unidad suelta; producto 022 coincide con hioscina' });
    expect(r.filas[1].unidades).toBeNull();
    expect(semillaDeEmpresa('RYAN', 2)).toBe(true);
  });

  it('rechaza un encabezado desconocido o un archivo vacío', () => {
    expect(() => parseSemilla('a;b;c\n1;2;3')).toThrow(/Encabezado no reconocido/);
    expect(() => parseSemilla('\n\n')).toThrow(/vacío/);
  });

  it('normaliza familias y marcas', () => {
    expect(familiaDeSemilla('Cefalosporinas (en SAP: Articulos)')).toBe('Cefalosporinas');
    expect(familiaDeSemilla('Por asignar (SAP grupo 102)')).toBeNull();
    expect(marcaDeTipo('Marca por pais (CORVAL)')).toBe('CORVAL');
    expect(marcaDeTipo('Mexico (INST = sector salud publico, C = comercial privado)')).toBeNull();
  });
});

describe('Vitrina · exclusividades', () => {
  it('estado por vigencia', () => {
    expect(estadoExclusividad(null, null, HOY)).toBe('VIGENTE');
    expect(estadoExclusividad(null, '2026-10-21', HOY)).toBe('VENCIDA');
    expect(estadoExclusividad(null, '2026-11-15', HOY)).toBe('POR_VENCER');
    expect(estadoExclusividad('2026-12-01', null, HOY)).toBe('FUTURA');
  });

  it('valida la vigencia', () => {
    expect(validarVigencia('2026-01-01', '')).toEqual({ desde: '2026-01-01', hasta: null });
    expect(() => validarVigencia('2026-02-01', '2026-01-01')).toThrow(/posterior/);
    expect(() => validarVigencia('31/12/2026', null)).toThrow(/no es válida/);
  });
});

describe('Vitrina · concentración sugerida', () => {
  it('une dosis con «/» o «+»', () => {
    expect(parsePresentacionSugerida('Adrenalina 1 mg/mL x10')?.concentracion).toBe('1 mg/mL');
    expect(parsePresentacionSugerida('Ampicilina + Sulbactam 1 g + 0,5 g x10')?.concentracion).toBe('1 g+0,5 g');
  });
});
