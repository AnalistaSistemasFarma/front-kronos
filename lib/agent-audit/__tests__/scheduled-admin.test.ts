import { describe, expect, it } from 'vitest';
import { esAccion, esAdministrable, llavesEjecutor, motivoNoPermitida, type JobParaAccion } from '../scheduled-admin';
import { hostDelEjecutor } from '../executor-auth';
import { planAvisos, tituloFallando, tituloMuerta } from '../scheduled-avisos';
import { calcularHuella } from '../errors';

const carter: JobParaAccion = {
  tipo: 'launchd',
  ref: 'com.jorge.carter.certificaciones',
  host: 'jorge',
  cargada: true,
  habilitada: true,
  estado: 'activa',
  ultimaCorrida: '2026-11-04T21:00:00Z',
  ultimaOk: true,
};

describe('lista blanca (esAdministrable)', () => {
  it('acepta las automatizaciones de negocio del catálogo (launchd y openclaw)', () => {
    expect(esAdministrable(carter).ok).toBe(true);
    expect(esAdministrable({ tipo: 'openclaw', ref: 'openclaw:pedro:6da2fcc7-61af-4a87-b433-86b93f1da11c', host: 'pedro' }).ok).toBe(true);
  });

  it('rechaza lo que no está en el catálogo, aunque parezca de negocio', () => {
    expect(esAdministrable({ ...carter, ref: 'com.jorge.carter.otra-cosa' }).ok).toBe(false);
  });

  it('rechaza bots principales e infraestructura de la flota', () => {
    for (const ref of [
      'com.horus.horus',
      'com.jorge.carter',
      'com.horus.curador',
      'com.horus.rotacion-sesion.mechita',
      'com.horus.agent-errors',
      'com.horus.contexto-agentes',
      'com.horus.cloudflared-tunnel',
    ])
      expect(esAdministrable({ ...carter, ref, host: 'local' }).ok).toBe(false);
  });

  it('las entradas internas del catálogo (_nota, _excluir) no cuentan', () => {
    expect(esAdministrable({ ...carter, ref: '_excluir' }).ok).toBe(false);
  });

  it('cron no se administra, ni sin ref, ni openclaw de otro equipo, ni serfarma', () => {
    expect(esAdministrable({ tipo: 'cron', ref: null, host: 'jorge' }).motivo).toMatch(/cron/);
    expect(esAdministrable({ ...carter, ref: null }).ok).toBe(false);
    expect(esAdministrable({ tipo: 'openclaw', ref: 'openclaw:pedro:6da2fcc7-61af-4a87-b433-86b93f1da11c', host: 'lisa' }).ok).toBe(false);
    expect(esAdministrable({ ...carter, host: 'serfarma07' }).ok).toBe(false);
  });
});

describe('motivoNoPermitida', () => {
  const ahora = new Date('2026-11-04T23:00:00Z');
  it('pausar una activa sí; reanudar una activa no', () => {
    expect(motivoNoPermitida('pausar', carter, ahora)).toBeNull();
    expect(motivoNoPermitida('reanudar', carter, ahora)).toMatch(/No está pausada/);
    expect(motivoNoPermitida('ejecutar', carter, ahora)).toBeNull();
  });
  it('una pausada solo se reanuda', () => {
    const p = { ...carter, cargada: false, estado: 'pausada' };
    expect(motivoNoPermitida('pausar', p, ahora)).toMatch(/Ya está pausada/);
    expect(motivoNoPermitida('ejecutar', p, ahora)).toMatch(/reanúdela/);
    expect(motivoNoPermitida('reanudar', p, ahora)).toBeNull();
  });
  it('si parece estar corriendo, no se ejecuta ni se pausa', () => {
    const corriendo = { ...carter, ultimaCorrida: '2026-11-04T22:30:00Z', ultimaOk: null };
    expect(motivoNoPermitida('ejecutar', corriendo, ahora)).toMatch(/corriendo/);
    expect(motivoNoPermitida('pausar', corriendo, ahora)).toMatch(/corriendo/);
  });
  it('fuera de la lista blanca, ninguna acción', () => {
    expect(motivoNoPermitida('pausar', { ...carter, ref: 'com.horus.curador' }, ahora)).not.toBeNull();
  });
  it('esAccion', () => {
    expect(esAccion('pausar')).toBe(true);
    expect(esAccion('borrar')).toBe(false);
  });
});

describe('llaves del ejecutor', () => {
  const llave = 'a'.repeat(40);
  const env = { AGENT_SCHEDULED_EXECUTOR_KEYS: `local:${llave}, jorge:${'b'.repeat(40)},pedro:corta,:${"c".repeat(40)}` } as unknown as NodeJS.ProcessEnv;
  it('solo llaves de 32+ caracteres con equipo válido', () => {
    expect(llavesEjecutor(env).map((k) => k.host)).toEqual(['local', 'jorge']);
    expect(llavesEjecutor({} as NodeJS.ProcessEnv)).toEqual([]);
  });
  it('la llave identifica SU equipo; sin variable, cerrado', () => {
    const req = (t: string) => new Request('http://x', { headers: { authorization: `Bearer ${t}` } });
    expect(hostDelEjecutor(req(llave), env)).toBe('local');
    expect(hostDelEjecutor(req('b'.repeat(40)), env)).toBe('jorge');
    expect(hostDelEjecutor(req('x'.repeat(40)), env)).toBeNull();
    expect(hostDelEjecutor(req(llave), {} as NodeJS.ProcessEnv)).toBeNull();
    expect(hostDelEjecutor(new Request('http://x'), env)).toBeNull();
  });
});

describe('planAvisos (Errores de IA)', () => {
  const j = {
    code: 'carter',
    host: 'jorge',
    clave: 'jorge:launchd:com.jorge.carter.certificaciones',
    nombre: 'Certificaciones laborales',
    saludDetalle: 'Debía correr el 2026-11-04 16:00 y no corrió.',
    esperada: '2026-11-04T21:00:00.000Z',
    ultimaCorrida: '2026-11-03T21:00:00.000Z',
    vistoAt: '2026-11-04T23:00:00.000Z',
  };
  it('muerta y fallando generan un evento alta del tipo automatizacion; la clave cambia por hora perdida', () => {
    const p = planAvisos([{ ...j, salud: 'muerta' }, { ...j, clave: 'x', nombre: 'Otra', salud: 'fallando' }], 'prod');
    expect(p.eventos).toHaveLength(2);
    expect(p.eventos[0]).toMatchObject({ agente: 'carter', tipo: 'automatizacion', severidad: 'alta', ambiente: 'prod', ocurrioEn: j.esperada });
    expect(String(p.eventos[0].clave)).toContain(j.esperada);
    expect(p.eventos[1].titulo).toBe(tituloFallando({ nombre: 'Otra', host: 'jorge' }));
  });
  it('las sanas y las pausadas resuelven sus dos huellas; sin datos no toca nada', () => {
    const p = planAvisos([{ ...j, salud: 'ok' }, { ...j, salud: 'sin_datos' }], 'pruebas');
    expect(p.eventos).toHaveLength(0);
    expect(p.resolver).toEqual([
      calcularHuella('carter', 'automatizacion', 'pruebas', tituloMuerta(j)),
      calcularHuella('carter', 'automatizacion', 'pruebas', tituloFallando(j)),
    ]);
  });
});
