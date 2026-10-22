import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OT_CATALOGO_FARMALOGICA, OT_PICTOGRAMAS, OT_SIGNIFICADO_CIERRE_JEFE, otPictograma } from '../constants';
import {
  assertActoresDistintos,
  assertNoBloqueado,
  assertPuedeConfirmar,
  esCierreDelJefe,
  huellaContenido,
  LimiteReautenticacion,
  metodoConfirmacion,
  OT_CONFIRMACION_TEXTO,
  OT_CONFIRMACION_VERSION,
  OT_FIRMA_SIGNIFICADO,
  parseConfirmacion,
  rolVisible,
  significadoCierre,
  siguienteVistoBueno,
  vistosCompletos,
  vistosDados,
  vistosRequeridos,
  type ContenidoFirmable,
  type FirmaFila,
  type OrdenActores,
} from '../firmas';
import { isOtError, OtError } from '../rules';

const sup = { idCompany: 1, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true };
const op_ = { ...sup, canManage: false };

function errorOf(fn: () => unknown): OtError {
  try {
    fn();
  } catch (e) {
    if (isOtError(e)) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

const base: ContenidoFirmable = {
  idOrden: 7, idCompany: 1, consecutivo: 3, producto: 'Cefazolina', itemCode: 'PTCZ0121', lote: 'L1', turno: 'MANANA', area: null,
  sapOpDocNum: 14045, supervisor: 'sup', inspector: 'insp', abiertaEn: '2026-10-13T20:00:00.000Z', auxiliares: ['b', 'a'],
  registros: [{ id: '1', actividad: 'Alimentación Tapón', usuario: 'a', registradoEn: '2026-10-13T20:05:00.000Z', observacion: null }],
  observacionCierre: null,
};

describe('Bitácora de Proceso · cuatro vistos buenos (B2/B3, 2026-10-15)', () => {
  const abierta: OrdenActores = { estado: 'ABIERTA', inspector: 'insp', jefe: 'jefe', operadores: [7, 8] };
  const cerrada: OrdenActores = { ...abierta, estado: 'CERRADA' };
  const f = (rol: string, id_user: string, significado = 'Visto bueno'): FirmaFila => ({ rol, significado, id_user });
  const cerro = f('SUPERVISOR', 'sup', 'Cerró');

  it('es un visto bueno propio de la bitácora: sin consentimiento de GSS Firma, sin contraseña, con «Sí, confirmo»', () => {
    expect(OT_CONFIRMACION_VERSION).toBe('bitacora-visto-bueno-2026-10-17');
    expect(OT_FIRMA_SIGNIFICADO).toEqual({ OPERARIO: 'Visto bueno', SUPERVISOR: 'Cerró', INSPECTOR: 'Visto bueno', JEFE_PROD: 'Visto bueno' });
    expect(Object.values(OT_CONFIRMACION_TEXTO).join(' ')).not.toMatch(/ley 527|firma electr|contraseña/i);
  });

  it('las filas viejas INSPECTOR «Verificó» se leen como el visto bueno del JEFE de producción', () => {
    expect(rolVisible({ rol: 'INSPECTOR', significado: 'Verificó' })).toBe('JEFE_PROD');
    expect(rolVisible({ rol: 'INSPECTOR', significado: 'Visto bueno' })).toBe('INSPECTOR');
    expect(rolVisible({ rol: 'SUPERVISOR', significado: 'Cerró' })).toBe('SUPERVISOR');
    expect(rolVisible({ rol: 'OTRO', significado: 'x' })).toBeNull();
    const dados = vistosDados([cerro, f('INSPECTOR', 'jefe', 'Verificó')]);
    expect(dados.JEFE_PROD?.id_user).toBe('jefe');
    expect(dados.INSPECTOR).toBeNull();
    // Bitácora del #617 (sin inspector ni operarios): completa con «Cerró» + «Verificó».
    const vieja: OrdenActores = { estado: 'CERRADA', inspector: null, jefe: 'jefe', operadores: [] };
    expect(vistosRequeridos(vieja)).toEqual(['SUPERVISOR', 'JEFE_PROD']);
    expect(vistosCompletos(vieja, [cerro, f('INSPECTOR', 'jefe', 'Verificó')])).toBe(true);
    expect(vistosCompletos(vieja, [cerro])).toBe(false);
  });

  it('orden: (operario opcional) → cierre → inspector → jefe; solo se exigen los actores que la bitácora tiene (R4)', () => {
    expect(vistosRequeridos(abierta)).toEqual(['SUPERVISOR', 'INSPECTOR', 'JEFE_PROD']);
    // R4: el del operario ya no es requisito: lo siguiente en una abierta es el cierre.
    expect(siguienteVistoBueno(abierta, [])).toBe('SUPERVISOR');
    const op = { ...f('OPERARIO', 'tablet'), id_operador: 7 };
    expect(siguienteVistoBueno(abierta, [op])).toBe('SUPERVISOR');
    // Cerrada sin visto bueno del operario: igual se completa con inspector y jefe.
    expect(vistosCompletos(cerrada, [cerro, f('INSPECTOR', 'insp'), f('JEFE_PROD', 'jefe')])).toBe(true);
    expect(siguienteVistoBueno(cerrada, [op, cerro])).toBe('INSPECTOR');
    expect(siguienteVistoBueno(cerrada, [op, cerro, f('INSPECTOR', 'insp')])).toBe('JEFE_PROD');
    expect(vistosCompletos(cerrada, [op, cerro, f('INSPECTOR', 'insp'), f('JEFE_PROD', 'jefe')])).toBe(true);
    expect(vistosRequeridos({ ...abierta, operadores: [] })[0]).toBe('SUPERVISOR');
  });

  it('operario: cualquiera de los programados, antes del cierre, una sola vez', () => {
    expect(() => assertPuedeConfirmar(abierta, [], { rol: 'OPERARIO', idUser: null, idOperador: 8, access: null })).not.toThrow();
    expect(errorOf(() => assertPuedeConfirmar(abierta, [], { rol: 'OPERARIO', idUser: null, idOperador: 99, access: null })).status).toBe(403);
    expect(errorOf(() => assertPuedeConfirmar(cerrada, [], { rol: 'OPERARIO', idUser: null, idOperador: 7, access: null })).status).toBe(409);
    expect(errorOf(() => assertPuedeConfirmar({ ...abierta, operadores: [] }, [], { rol: 'OPERARIO', idUser: null, idOperador: 7, access: null })).status).toBe(409);
    expect(errorOf(() => assertPuedeConfirmar(abierta, [f('OPERARIO', 't')], { rol: 'OPERARIO', idUser: null, idOperador: 7, access: null })).status).toBe(409);
  });

  it('cierre por el supervisor: con Gestión (su acceso, no el de la sesión), nunca el inspector y SIN esperar al operario (R4)', () => {
    const op = f('OPERARIO', 't');
    expect(assertPuedeConfirmar(abierta, [op], { rol: 'SUPERVISOR', idUser: 'sup', idOperador: null, access: sup })).toBe('SUPERVISOR');
    // R4: sin el visto bueno del operario también cierra.
    expect(assertPuedeConfirmar(abierta, [], { rol: 'SUPERVISOR', idUser: 'sup', idOperador: null, access: sup })).toBe('SUPERVISOR');
    const sinGestion = errorOf(() => assertPuedeConfirmar(abierta, [op], { rol: 'SUPERVISOR', idUser: 'u', idOperador: null, access: op_ }));
    expect(sinGestion.status).toBe(403);
    expect(sinGestion.message).toMatch(/le falta el permiso «Bitácora de Proceso: Gestión».*jefe de producción designado/);
    expect(errorOf(() => assertPuedeConfirmar(abierta, [op], { rol: 'SUPERVISOR', idUser: 'u', idOperador: null, access: null })).status).toBe(403);
    // El inspector nunca cierra, ni con Gestión.
    const insp = errorOf(() => assertPuedeConfirmar(abierta, [op], { rol: 'SUPERVISOR', idUser: 'insp', idOperador: null, access: sup }));
    expect(insp.status).toBe(403);
    expect(insp.message).toMatch(/inspector de esta bitácora no puede cerrarla/);
    expect(errorOf(() => assertPuedeConfirmar(cerrada, [op], { rol: 'SUPERVISOR', idUser: 'sup', idOperador: null, access: sup })).status).toBe(409);
    expect(errorOf(() => assertPuedeConfirmar(abierta, [cerro], { rol: 'SUPERVISOR', idUser: 'sup', idOperador: null, access: sup })).status).toBe(409);
    // Sin operarios programados (modelo anterior) no se exige el del operario.
    expect(() => assertPuedeConfirmar({ ...abierta, operadores: [] }, [], { rol: 'SUPERVISOR', idUser: 'sup', idOperador: null, access: sup })).not.toThrow();
  });

  it('inspector y jefe: solo el designado, después del cierre, el jefe después del inspector y nunca quien cerró', () => {
    const c = (rol: 'INSPECTOR' | 'JEFE_PROD', idUser: string) => ({ rol, idUser, idOperador: null, access: op_ });
    expect(errorOf(() => assertPuedeConfirmar(abierta, [], c('INSPECTOR', 'insp'))).status).toBe(409);
    expect(errorOf(() => assertPuedeConfirmar(cerrada, [cerro], c('INSPECTOR', 'otro'))).status).toBe(403);
    expect(() => assertPuedeConfirmar(cerrada, [cerro], c('INSPECTOR', 'insp'))).not.toThrow();
    expect(errorOf(() => assertPuedeConfirmar(cerrada, [cerro], c('JEFE_PROD', 'jefe'))).message).toMatch(/inspector/);
    expect(() => assertPuedeConfirmar(cerrada, [cerro, f('INSPECTOR', 'insp')], c('JEFE_PROD', 'jefe'))).not.toThrow();
    expect(errorOf(() => assertPuedeConfirmar(cerrada, [cerro, f('INSPECTOR', 'insp')], c('INSPECTOR', 'insp'))).status).toBe(409);
    expect(errorOf(() => assertPuedeConfirmar({ ...cerrada, inspector: null }, [cerro], c('INSPECTOR', 'insp'))).status).toBe(409);
    // Sin inspector designado (bitácoras del #617), el jefe va directo después del cierre.
    expect(() => assertPuedeConfirmar({ ...cerrada, inspector: null }, [cerro], c('JEFE_PROD', 'jefe'))).not.toThrow();
    // Quien cerró no da otro visto bueno.
    expect(errorOf(() => assertPuedeConfirmar({ ...cerrada, inspector: 'sup' }, [cerro], c('INSPECTOR', 'sup'))).status).toBe(403);
    // El «Verificó» viejo cuenta como el del jefe: no se repite.
    expect(errorOf(() => assertPuedeConfirmar({ ...cerrada, inspector: null }, [cerro, f('INSPECTOR', 'jefe', 'Verificó')], c('JEFE_PROD', 'jefe'))).status).toBe(409);
  });

  it('al abrir (R3): el inspector es distinto de quien abre y del jefe; quien abre SÍ puede ser el jefe', () => {
    expect(() => assertActoresDistintos({ abre: 's', inspector: 'i', jefe: 'j' })).not.toThrow();
    expect(() => assertActoresDistintos({ abre: 'j', inspector: 'i', jefe: 'j' })).not.toThrow();
    expect(errorOf(() => assertActoresDistintos({ abre: 's', inspector: 's', jefe: 'j' })).status).toBe(400);
    expect(errorOf(() => assertActoresDistintos({ abre: 's', inspector: 'i', jefe: 'i' })).status).toBe(400);
  });

  it('R3: el JEFE designado cierra (aun sin Gestión); su cierre cuenta como su visto bueno y queda la traza «Cerró (jefe)»', () => {
    const c = (rol: 'SUPERVISOR' | 'INSPECTOR' | 'JEFE_PROD', idUser: string, access = op_) => ({ rol, idUser, idOperador: null, access });
    expect(assertPuedeConfirmar(abierta, [], c('SUPERVISOR', 'jefe'))).toBe('JEFE_PROD');
    // Un jefe que NO es el designado de esta bitácora, sin Gestión, no cierra.
    expect(errorOf(() => assertPuedeConfirmar(abierta, [], c('SUPERVISOR', 'otro-jefe'))).status).toBe(403);
    expect(significadoCierre('JEFE_PROD')).toBe(OT_SIGNIFICADO_CIERRE_JEFE);
    expect(significadoCierre('SUPERVISOR')).toBe('Cerró');
    expect(OT_SIGNIFICADO_CIERRE_JEFE.length).toBeLessThanOrEqual(20); // ot_firma.significado NVARCHAR(20)
    const cerroJefe = f('SUPERVISOR', 'jefe', OT_SIGNIFICADO_CIERRE_JEFE);
    expect(esCierreDelJefe(cerroJefe)).toBe(true);
    expect(esCierreDelJefe(cerro)).toBe(false);
    expect(rolVisible(cerroJefe)).toBe('SUPERVISOR');
    // Después del cierre del jefe solo falta el inspector; el jefe no firma otra vez.
    expect(vistosRequeridos(cerrada, [cerroJefe])).toEqual(['SUPERVISOR', 'INSPECTOR']);
    expect(siguienteVistoBueno(cerrada, [cerroJefe])).toBe('INSPECTOR');
    expect(() => assertPuedeConfirmar(cerrada, [cerroJefe], c('INSPECTOR', 'insp'))).not.toThrow();
    expect(vistosCompletos(cerrada, [cerroJefe, f('INSPECTOR', 'insp')])).toBe(true);
    const otraVez = errorOf(() => assertPuedeConfirmar(cerrada, [cerroJefe, f('INSPECTOR', 'insp')], c('JEFE_PROD', 'jefe')));
    expect(otraVez.status).toBe(409);
    expect(otraVez.message).toMatch(/su cierre cuenta como su visto bueno/);
    // Sin inspector designado (#617), el cierre del jefe la deja completa.
    expect(vistosCompletos({ ...cerrada, inspector: null }, [cerroJefe])).toBe(true);
    // Si cierra el supervisor, el jefe sigue dando el último visto bueno.
    expect(siguienteVistoBueno(cerrada, [cerro, f('INSPECTOR', 'insp')])).toBe('JEFE_PROD');
  });

  it('R3: la huella del cierre del jefe incluye con qué rol cerró; la del supervisor no cambia (huellas anteriores intactas)', () => {
    const cierre = { ...base, cerradaPor: 'jefe', cerradaEn: null, observacionCierre: 'fin' };
    const sinCampo = huellaContenido(cierre);
    expect(huellaContenido({ ...cierre, cierreComo: 'SUPERVISOR' })).toBe(sinCampo);
    expect(huellaContenido({ ...cierre, cierreComo: null })).toBe(sinCampo);
    expect(huellaContenido({ ...cierre, cierreComo: 'JEFE_PROD' })).not.toBe(sinCampo);
  });

  it('cuerpo: rol, «Sí, confirmo», persona u operario y PIN opcional de 4 dígitos; sin contraseña', () => {
    expect(parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: ' u1 ', observacion: ' fin ' })).toEqual({ rol: 'SUPERVISOR', persona: 'u1', idOperador: null, pin: null, observacion: 'fin' });
    expect(parseConfirmacion({ rol: 'OPERARIO', confirmo: true, operador: '7', observacion: 'x' })).toEqual({ rol: 'OPERARIO', persona: null, idOperador: 7, pin: null, observacion: null });
    expect(parseConfirmacion({ rol: 'JEFE_PROD', confirmo: true, persona: 'j', pin: '4821' }).pin).toBe('4821');
    expect(errorOf(() => parseConfirmacion(null)).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'CALIDAD', confirmo: true, persona: 'u' })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'SUPERVISOR', persona: 'u' })).message).toMatch(/Sí, confirmo/);
    expect(errorOf(() => parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: 'x'.repeat(51) })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'OPERARIO', confirmo: true })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'INSPECTOR', confirmo: true, persona: 'i', pin: '12a4' })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: 'u', observacion: 'x'.repeat(1001) })).status).toBe(400);
    expect(parseConfirmacion({ confirmo: true, firmante: 'u' }, 'SUPERVISOR').persona).toBe('u');
  });

  it('método: sesión propia sin PIN; otra sesión exige PIN; el operario, en la tablet', () => {
    expect(metodoConfirmacion({ rol: 'SUPERVISOR', persona: 'u1', pin: null }, 'u1')).toBe('sesion_propia');
    expect(metodoConfirmacion({ rol: 'INSPECTOR', persona: 'u1', pin: '4821' }, 'tablet')).toBe('pin_tablet');
    expect(errorOf(() => metodoConfirmacion({ rol: 'JEFE_PROD', persona: 'u1', pin: null }, 'tablet')).message).toMatch(/PIN/);
    expect(metodoConfirmacion({ rol: 'OPERARIO', persona: null, pin: null }, 'tablet')).toBe('operario_tablet');
  });

  it('la huella SHA-256 es estable (no depende del orden de auxiliares ni operarios) y cambia si cambia el contenido', () => {
    const h = huellaContenido(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaContenido({ ...base, auxiliares: ['a', 'b'] })).toBe(h);
    const conOps = huellaContenido({ ...base, operadores: [8, 7] });
    expect(huellaContenido({ ...base, operadores: [7, 8] })).toBe(conOps);
    expect(conOps).not.toBe(h);
    expect(huellaContenido({ ...base, registros: [{ ...base.registros[0], operador: 7 }] })).not.toBe(h);
    expect(huellaContenido({ ...base, registros: [{ ...base.registros[0], observacion: 'x' }] })).not.toBe(h);
    expect(huellaContenido({ ...base, lote: 'L2' })).not.toBe(h);
    expect(huellaContenido({ ...base, firmaSupervisorSha256: 'abc' })).not.toBe(h);
    expect(huellaContenido({ ...base, jefeProduccion: 'jefe' })).not.toBe(h);
    expect(huellaContenido({ ...base, vistosPrevios: [{ rol: 'SUPERVISOR', sha256: 'a' }] })).not.toBe(h);
  });

  it('bloquea la confirmación tras 5 contraseñas incorrectas en 15 minutos (y se libera después)', () => {
    const lim = new LimiteReautenticacion(5, 15 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) lim.registrarFallo('Sup@F.com', t0);
    expect(() => assertNoBloqueado(lim, 'sup@f.com', t0)).not.toThrow();
    lim.registrarFallo('sup@f.com', t0);
    expect(errorOf(() => assertNoBloqueado(lim, 'sup@f.com', t0 + 1000)).status).toBe(429);
    expect(lim.bloqueado('sup@f.com', t0 + 16 * 60_000)).toBe(false);
    lim.registrarFallo('x@f.com', t0);
    lim.limpiar('x@f.com');
    expect(lim.bloqueado('x@f.com', t0)).toBe(false);
  });
});

describe('Bitácora de Proceso · pictogramas de la especificación', () => {
  it('las 3 alimentaciones usan su pictograma y los archivos existen en public/', () => {
    const alimentaciones = OT_CATALOGO_FARMALOGICA.slice(0, 3);
    expect(alimentaciones.map((a) => otPictograma(a.icono))).toEqual([
      '/bitacora-proceso/alimentacion-tapon.webp',
      '/bitacora-proceso/alimentacion-mprima.webp',
      '/bitacora-proceso/alimentacion-agrafe.webp',
    ]);
    for (const src of Object.values(OT_PICTOGRAMAS)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio (OT_PICTOGRAMAS)
      expect(existsSync(fileURLToPath(new URL(`../../../public${src}`, import.meta.url)))).toBe(true);
    }
    expect(otPictograma('pesaje')).toBeNull();
    expect(otPictograma(null)).toBeNull();
  });
});
