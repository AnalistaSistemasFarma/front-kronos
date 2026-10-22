import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// «Crear ticket» desde un hilo del Correo: SOLO TI (técnicos de la mesa de ayuda), con la base y el buzón simulados.
const db = vi.hoisted(() => {
  const names = ['usuariosPorCorreo', 'usuarioDeEmpresa', 'ticketDeHilo', 'reservarTicket', 'activarTicket', 'liberarTicket', 'auditar'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('../db', () => db);

import { readCorreoConfig } from '../config';
import { reiniciarBuzonSimulado } from '../mock';
import type { CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';
import { asuntoTicket, crearTicketDesdeHilo, exigirTI, parseEntradaTicket, prepararTicket, puedeCrearTicket, ticketDelHilo, type TicketPort } from '../ticket';

const yo: AccesoCorreo = {
  idUser: 'op1',
  nombre: 'Técnico TI',
  email: 'ti@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }, { idCompany: 2, companyName: 'OLP' }],
};

function puerto(esTecnico: boolean, extra: Partial<TicketPort> = {}): TicketPort {
  return {
    esTecnico: vi.fn(async () => esTecnico),
    catalogo: vi.fn(async () => ({
      categorias: [{ id: 4, nombre: 'Software' }],
      departamentos: [{ id: 7, nombre: 'Tecnología' }],
      tecnicos: [{ id: 149, nombre: 'Técnico TI', correo: 'ti@gsslatam.com' }],
    })),
    validarClasificacion: vi.fn(async () => null),
    companyUser: vi.fn(async (idUser: string) => (idUser === 'u-remitente' ? 33 : 12)),
    casoExiste: vi.fn(async () => true),
    crearCaso: vi.fn(async () => 416),
    subirAdjuntos: vi.fn(async (_id: number, a: unknown[]) => ({ subidos: a.length, fallidos: [] })),
    ...extra,
  };
}

function deps(t: TicketPort | undefined): CorreoDeps {
  return {
    db: {} as never,
    cfg: readCorreoConfig({ CORREO_MODO: 'mock' }),
    kronos: { catalogoEmpresa: vi.fn(), solicitudVisible: vi.fn(), solicitudExiste: vi.fn(), insertarNota: vi.fn() },
    crearSolicitud: vi.fn(),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(),
    dominiosGrupo: ['gsslatam.com'],
    ...(t ? { ticket: t } : {}),
  };
}

const entrada = {
  conversationId: 'mock-conv-01AAAA',
  idCompany: 1,
  idSolicitante: 'u-remitente',
  tipo: 'Incidente',
  prioridad: 'Alta',
  sitio: 'Administrativa',
  categoria: 4,
  subcategoria: 5,
  actividad: 6,
  departamento: 7,
  tecnico: 149,
  asunto: 'Usuario de Prueba Uno - Revisión de contrato',
  descripcion: 'No abre el contrato adjunto en el equipo.',
  adjuntosIds: ['mock-adj-1AAAA'],
};

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  db.usuariosPorCorreo.mockResolvedValue(new Map([['prueba.uno@gsslatam.com', { id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] }]]));
  db.usuarioDeEmpresa.mockResolvedValue({ id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] });
  db.ticketDeHilo.mockResolvedValue(null);
  db.reservarTicket.mockResolvedValue({ idReserva: 9 });
});

describe('Correo · «Crear ticket» — permiso (solo TI)', () => {
  it('TI (técnico de la mesa de ayuda) sí puede', async () => {
    const d = deps(puerto(true));
    await expect(puedeCrearTicket(d, yo)).resolves.toBe(true);
    await expect(exigirTI(d, yo)).resolves.toBe(d.ticket);
    expect(d.ticket!.esTecnico).toHaveBeenCalledWith('ti@gsslatam.com');
  });

  it('no-TI NO puede: 403 SOLO_TI al preparar, consultar o crear, y nada se escribe', async () => {
    const t = puerto(false);
    const d = deps(t);
    await expect(puedeCrearTicket(d, yo)).resolves.toBe(false);
    await expect(prepararTicket(d, yo, 'mock-conv-01AAAA')).rejects.toMatchObject({ status: 403, code: 'SOLO_TI' });
    await expect(ticketDelHilo(d, yo, 'mock-conv-01AAAA')).rejects.toMatchObject({ status: 403, code: 'SOLO_TI' });
    await expect(crearTicketDesdeHilo(d, yo, entrada, null)).rejects.toMatchObject({ status: 403, code: 'SOLO_TI' });
    expect(t.crearCaso).not.toHaveBeenCalled();
    expect(db.reservarTicket).not.toHaveBeenCalled();
    expect(db.auditar).not.toHaveBeenCalled();
  });

  it('sin el puerto configurado, o si la consulta del roster falla, nadie puede', async () => {
    await expect(puedeCrearTicket(deps(undefined), yo)).resolves.toBe(false);
    await expect(puedeCrearTicket(deps(puerto(true, { esTecnico: vi.fn(async () => Promise.reject(new Error('BD caída'))) })), yo)).resolves.toBe(false);
    await expect(crearTicketDesdeHilo(deps(undefined), yo, entrada, null)).rejects.toMatchObject({ status: 403 });
  });
});

describe('Correo · «Crear ticket» — precarga y creación', () => {
  it('precarga asunto «Remitente - asunto», descripción, solicitante por remitente, técnico propio y adjuntos', async () => {
    const p = await prepararTicket(deps(puerto(true)), yo, 'mock-conv-01AAAA');
    expect(p.asunto).toBe('Usuario de Prueba Uno - Revisión de contrato de arrendamiento bodega');
    expect(p.descripcion).toContain('prueba.uno@gsslatam.com');
    expect(p.solicitante).toMatchObject({ id: 'u-remitente' });
    expect(p.idCompany).toBe(1);
    expect(p.idTecnico).toBe(149);
    expect(p.adjuntos.map((a) => a.id)).toContain('mock-adj-1AAAA');
    expect(p.ticketExistente).toBeNull();
  });

  it('crea el ticket con requester = id_company_user del solicitante y el remitente como contacto; relaciona el hilo, copia adjuntos y audita', async () => {
    const t = puerto(true);
    const r = await crearTicketDesdeHilo(deps(t), yo, entrada, '10.0.0.1');
    expect(r).toMatchObject({ idCase: 416, adjuntosSubidos: 1, adjuntosFallidos: [] });
    expect(t.crearCaso).toHaveBeenCalledWith(expect.objectContaining({ requester: 33, correoContacto: 'prueba.uno@gsslatam.com', idCompany: 1, tecnico: 149, tipo: 'Incidente' }));
    expect(db.reservarTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idUser: 'op1', conversationId: 'mock-conv-01AAAA' }));
    expect(db.activarTicket).toHaveBeenCalledWith(expect.anything(), 9, 416);
    expect(t.subirAdjuntos).toHaveBeenCalledWith(416, [expect.objectContaining({ nombre: 'soporte-1.pdf' })]);
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'CREAR_TICKET', detalle: expect.stringContaining('Ticket #416') }));
  });

  it('sin solicitante: el ticket queda a nombre de la persona (convención de casos por correo)', async () => {
    const t = puerto(true);
    await crearTicketDesdeHilo(deps(t), yo, { ...entrada, idSolicitante: null }, null);
    expect(t.companyUser).toHaveBeenCalledWith('op1', 1);
    expect(t.crearCaso).toHaveBeenCalledWith(expect.objectContaining({ requester: 12, correoContacto: 'prueba.uno@gsslatam.com' }));
  });

  it('si falla el INSERT, libera la reserva del hilo', async () => {
    const t = puerto(true, { crearCaso: vi.fn(async () => Promise.reject(new Error('BD caída'))) });
    await expect(crearTicketDesdeHilo(deps(t), yo, entrada, null)).rejects.toThrow('BD caída');
    expect(db.liberarTicket).toHaveBeenCalledWith(expect.anything(), 9);
    expect(db.activarTicket).not.toHaveBeenCalled();
  });

  it('rechaza empresa ajena, clasificación incoherente y solicitante de otra empresa', async () => {
    await expect(crearTicketDesdeHilo(deps(puerto(true)), yo, { ...entrada, idCompany: 99 }, null)).rejects.toMatchObject({ status: 403 });
    const t = puerto(true, { validarClasificacion: vi.fn(async () => 'La actividad no pertenece a la subcategoría elegida.') });
    await expect(crearTicketDesdeHilo(deps(t), yo, entrada, null)).rejects.toMatchObject({ status: 400 });
    db.usuarioDeEmpresa.mockResolvedValueOnce(null);
    await expect(crearTicketDesdeHilo(deps(puerto(true)), yo, entrada, null)).rejects.toMatchObject({ status: 400 });
  });

  it('valida la forma del cuerpo (tipo, prioridad, sitio, catálogos, descripción)', () => {
    expect(parseEntradaTicket({ ...entrada })).toMatchObject({ idCompany: 1, tecnico: 149 });
    expect(parseEntradaTicket({ ...entrada, tecnico: '' }).tecnico).toBeNull();
    expect(() => parseEntradaTicket({ ...entrada, tipo: 'Otro' })).toThrow('tipo');
    expect(() => parseEntradaTicket({ ...entrada, prioridad: 'Urgente' })).toThrow('prioridad');
    expect(() => parseEntradaTicket({ ...entrada, actividad: null })).toThrow('actividad');
    expect(() => parseEntradaTicket({ ...entrada, descripcion: 'corta' })).toThrow('10');
    expect(() => parseEntradaTicket({ ...entrada, conversationId: '../x' })).toThrow();
  });

  it('asunto: «Remitente - asunto» sin RE:/RV:', () => {
    expect(asuntoTicket({ nombre: 'Ana Pérez', correo: 'ana@x.com' }, 'RE: RV: No funciona la VPN')).toBe('Ana Pérez - No funciona la VPN');
  });
});

describe('Correo · «Crear ticket» — SQL', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (f: string) => {
    const s = leer(f);
    return s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  };
  it('PRUEBAS y PROD repiten el bloque DDL de la migración, con su guarda DB_NAME()', () => {
    const mig = bloque(join(raiz, 'migrations', '20261021200000_correo_ticket', 'migration.sql'));
    expect(mig).toContain('CREATE TABLE [dbo].[email_thread_case]');
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = join(raiz, 'manual', `2026-10-21-correo-ticket-${amb}.sql`);
      expect(bloque(f)).toBe(mig);
      expect(leer(f)).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    }
    const reversa = leer(join(raiz, 'manual', '2026-10-21-correo-ticket-reversa.sql'));
    expect(reversa).toContain('DB_NAME()');
    // Solo borra la relación: los tickets ([case], category_case) no se tocan.
    expect([...reversa.matchAll(/DROP TABLE (\S+?);/g)].map((m) => m[1])).toEqual(['[dbo].[email_thread_case]']);
    expect(reversa).not.toMatch(/\b(DELETE FROM|UPDATE)\b/i);
  });
});
