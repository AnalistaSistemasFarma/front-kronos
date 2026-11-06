import 'server-only';
import { prisma } from '../prisma';
import { tablaAusente } from './message-extras';
import {
  MAX_MIS_STICKERS,
  errorArchivoSticker,
  leerWebp,
  type EstadoPropuesta,
} from './stickers-personales-reglas';

/**
 * «MIS STICKERS» del chat — lado servidor (2026-10-21).
 *
 * Un sticker personal es una fila de chat_sticker (la imagen, con su CHECK de
 * tipo y de 512 KB) MÁS una fila en chat_sticker_personal que dice de quién
 * es. Va con id_company NULL; por eso TODA consulta de stickers de empresa
 * debe excluir los personales (`personal: { is: null }`): sin ese filtro, un
 * sticker personal parecería «de todas las empresas».
 *
 * Proponer a la empresa no cambia el sticker: al APROBAR, un administrador
 * crea una COPIA como sticker de esa empresa (fila nueva de chat_sticker con
 * id_company). Así la persona conserva el suyo y la empresa el aprobado.
 *
 * Si la tabla nueva aún no existe en la base (el código salió antes que el
 * SQL), los stickers de empresa siguen funcionando como en el #698 y «Mis
 * stickers» responde «aún no disponible».
 */

export class MisStickersNoDisponibles extends Error {
  constructor() {
    super('«Mis stickers» aún no está habilitado en esta base de datos.');
    this.name = 'MisStickersNoDisponibles';
  }
}

export class ErrorMiSticker extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'ErrorMiSticker';
  }
}

/** Filtro de stickers de EMPRESA visibles para quien tiene esas empresas (nunca los personales). */
export function filtroStickersDeEmpresa(empresas: number[]) {
  return {
    active: true,
    personal: { is: null },
    OR: [{ id_company: null }, ...(empresas.length ? [{ id_company: { in: empresas } }] : [])],
  };
}

/** El filtro del #698 (sin la tabla nueva). Solo como respaldo si falta chat_sticker_personal. */
function filtroStickersDeEmpresaSinPersonales(empresas: number[]) {
  return {
    active: true,
    OR: [{ id_company: null }, ...(empresas.length ? [{ id_company: { in: empresas } }] : [])],
  };
}

const ES_TABLA_PERSONAL = /chat_sticker_personal/i;
function faltaTablaPersonal(error: unknown): boolean {
  if (!tablaAusente(error)) return false;
  const e = error as { message?: string; meta?: { table?: string; modelName?: string } };
  // Prisma dice qué tabla falta; si no lo dice, se asume la nueva (la del #698 ya la revisan sus rutas).
  const donde = `${e.meta?.table ?? ''} ${e.meta?.modelName ?? ''} ${e.message ?? ''}`;
  return ES_TABLA_PERSONAL.test(donde) || !/chat_sticker\b|chat_message_media|chat_message_reaction/i.test(donde);
}

export interface FilaStickerEmpresa {
  id_sticker: number;
  label: string;
  keywords: string | null;
}

/** Stickers de empresa para el selector (con respaldo si falta la tabla nueva). */
export async function stickersDeEmpresa(empresas: number[]): Promise<FilaStickerEmpresa[]> {
  const consulta = (where: object) =>
    prisma.chatSticker.findMany({
      where,
      select: { id_sticker: true, label: true, keywords: true },
      orderBy: [{ sort_order: 'asc' }, { id_sticker: 'asc' }],
      take: 200,
    });
  try {
    return await consulta(filtroStickersDeEmpresa(empresas));
  } catch (error) {
    if (!faltaTablaPersonal(error)) throw error;
    return consulta(filtroStickersDeEmpresaSinPersonales(empresas));
  }
}

/**
 * El sticker que alguien quiere ENVIAR (provider 'empresa' + id_sticker): de
 * una de sus empresas (o de todas) o uno PROPIO que no haya quitado. Nunca el
 * sticker personal de otra persona.
 */
export async function stickerEnviable(
  idSticker: number,
  empresas: number[],
  yo: string
): Promise<{ id_sticker: number; label: string } | null> {
  try {
    return await prisma.chatSticker.findFirst({
      where: {
        id_sticker: idSticker,
        active: true,
        OR: [
          {
            personal: { is: null },
            OR: [{ id_company: null }, ...(empresas.length ? [{ id_company: { in: empresas } }] : [])],
          },
          { personal: { is: { id_user: yo, removed_at: null } } },
        ],
      },
      select: { id_sticker: true, label: true },
    });
  } catch (error) {
    if (!faltaTablaPersonal(error)) throw error;
    return prisma.chatSticker.findFirst({
      where: { id_sticker: idSticker, ...filtroStickersDeEmpresaSinPersonales(empresas) },
      select: { id_sticker: true, label: true },
    });
  }
}

export interface MiStickerDto {
  idSticker: number;
  label: string;
  src: string;
  animated: boolean;
  estado: EstadoPropuesta | null;
  idCompany: number | null;
  companyName: string | null;
}

function envolver<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (tablaAusente(error)) throw new MisStickersNoDisponibles();
    throw error;
  });
}

/** «Mis stickers» de una persona, del más nuevo al más viejo. Si falta la tabla, null. */
export async function misStickers(yo: string): Promise<MiStickerDto[] | null> {
  try {
    const filas = await prisma.chatStickerPersonal.findMany({
      where: { id_user: yo, removed_at: null, sticker: { active: true } },
      select: {
        id_sticker: true,
        proposal_state: true,
        proposed_company: true,
        company: { select: { company: true } },
        sticker: { select: { label: true, keywords: true } },
      },
      orderBy: { id_sticker: 'desc' },
      take: MAX_MIS_STICKERS,
    });
    return filas.map((f) => ({
      idSticker: f.id_sticker,
      label: f.sticker.label,
      src: `/api/chat/stickers/${f.id_sticker}`,
      // La marca de animado se guarda en keywords («animado»): así no hace falta otra columna.
      animated: (f.sticker.keywords ?? '').split(' ').includes('animado'),
      estado: (f.proposal_state as EstadoPropuesta | null) ?? null,
      idCompany: f.proposed_company,
      companyName: f.company?.company ?? null,
    }));
  } catch (error) {
    if (tablaAusente(error)) return null;
    throw error;
  }
}

/** Carga un sticker propio. Valida los BYTES (no la extensión). */
export async function crearMiSticker(yo: string, nombre: string, bytes: Uint8Array): Promise<MiStickerDto> {
  const problema = errorArchivoSticker(bytes);
  if (problema) throw new ErrorMiSticker(problema);
  const info = leerWebp(bytes)!;
  return envolver(async () => {
    const cuantos = await prisma.chatStickerPersonal.count({ where: { id_user: yo, removed_at: null } });
    if (cuantos >= MAX_MIS_STICKERS) {
      throw new ErrorMiSticker(`Ya tiene ${MAX_MIS_STICKERS} stickers propios. Quite alguno para agregar otro.`);
    }
    const creado = await prisma.$transaction(async (tx) => {
      const s = await tx.chatSticker.create({
        data: {
          id_company: null,
          label: nombre,
          keywords: `${nombre} ${info.animado ? 'animado' : 'estatico'} propio`.slice(0, 300),
          content_type: 'image/webp',
          image_data: Buffer.from(bytes),
          size_bytes: bytes.length,
          created_by: yo,
        },
        select: { id_sticker: true, label: true },
      });
      await tx.chatStickerPersonal.create({ data: { id_sticker: s.id_sticker, id_user: yo } });
      return s;
    });
    return {
      idSticker: creado.id_sticker,
      label: creado.label,
      src: `/api/chat/stickers/${creado.id_sticker}`,
      animated: info.animado,
      estado: null,
      idCompany: null,
      companyName: null,
    };
  });
}

async function delDueno(yo: string, idSticker: number) {
  const fila = await prisma.chatStickerPersonal.findUnique({
    where: { id_sticker: idSticker },
    select: { id_user: true, removed_at: true, proposal_state: true },
  });
  if (!fila || fila.id_user !== yo || fila.removed_at) throw new ErrorMiSticker('Ese sticker no existe.', 404);
  return fila;
}

/**
 * Lo quita de «Mis stickers». NO se borra la imagen: los mensajes que ya lo
 * enviaron lo siguen mostrando (como en WhatsApp).
 */
export async function quitarMiSticker(yo: string, idSticker: number): Promise<void> {
  await envolver(async () => {
    await delDueno(yo, idSticker);
    await prisma.chatStickerPersonal.update({ where: { id_sticker: idSticker }, data: { removed_at: new Date() } });
  });
}

/** Lo propone a UNA de las empresas de quien lo cargó. */
export async function proponerMiSticker(
  yo: string,
  idSticker: number,
  idCompany: number,
  empresasPermitidas: number[]
): Promise<void> {
  if (!empresasPermitidas.includes(idCompany)) throw new ErrorMiSticker('Solo puede proponerlo a una empresa donde usa el chat.');
  await envolver(async () => {
    const fila = await delDueno(yo, idSticker);
    if (fila.proposal_state === 'propuesto') throw new ErrorMiSticker('Ese sticker ya está propuesto; espere la revisión.');
    if (fila.proposal_state === 'aprobado') throw new ErrorMiSticker('Ese sticker ya fue aprobado por la empresa.');
    await prisma.chatStickerPersonal.update({
      where: { id_sticker: idSticker },
      data: {
        proposed_company: idCompany,
        proposal_state: 'propuesto',
        proposed_at: new Date(),
        reviewed_by: null,
        reviewed_at: null,
      },
    });
  });
}

export interface PropuestaDto {
  idSticker: number;
  label: string;
  src: string;
  autor: string;
  idCompany: number;
  companyName: string;
  proposedAt: string;
}

/** Propuestas pendientes (para administradores). */
export async function propuestasPendientes(): Promise<PropuestaDto[] | null> {
  try {
    const filas = await prisma.chatStickerPersonal.findMany({
      where: { proposal_state: 'propuesto', removed_at: null, sticker: { active: true } },
      select: {
        id_sticker: true,
        proposed_company: true,
        proposed_at: true,
        owner: { select: { name: true, email: true } },
        company: { select: { company: true } },
        sticker: { select: { label: true } },
      },
      orderBy: { proposed_at: 'asc' },
      take: 100,
    });
    return filas.map((f) => ({
      idSticker: f.id_sticker,
      label: f.sticker.label,
      src: `/api/chat/stickers/${f.id_sticker}`,
      autor: f.owner.name ?? f.owner.email,
      idCompany: f.proposed_company!,
      companyName: f.company?.company ?? '',
      proposedAt: (f.proposed_at ?? new Date(0)).toISOString(),
    }));
  } catch (error) {
    if (tablaAusente(error)) return null;
    throw error;
  }
}

/**
 * Aprueba (copia como sticker de la empresa) o rechaza una propuesta. Solo un
 * administrador: la ruta lo verifica antes de llamar aquí.
 */
export async function revisarPropuesta(revisor: string, idSticker: number, accion: 'aprobar' | 'rechazar'): Promise<void> {
  await envolver(async () => {
    await prisma.$transaction(async (tx) => {
      const p = await tx.chatStickerPersonal.findUnique({
        where: { id_sticker: idSticker },
        select: {
          proposal_state: true,
          proposed_company: true,
          removed_at: true,
          sticker: { select: { label: true, keywords: true, content_type: true, image_data: true, size_bytes: true, active: true } },
        },
      });
      if (!p || p.proposal_state !== 'propuesto' || p.removed_at || !p.sticker.active || p.proposed_company === null) {
        throw new ErrorMiSticker('Esa propuesta ya no está pendiente.', 409);
      }
      const ahora = new Date();
      if (accion === 'rechazar') {
        await tx.chatStickerPersonal.update({
          where: { id_sticker: idSticker },
          data: { proposal_state: 'rechazado', reviewed_by: revisor, reviewed_at: ahora },
        });
        return;
      }
      const copia = await tx.chatSticker.create({
        data: {
          id_company: p.proposed_company,
          label: p.sticker.label,
          keywords: (p.sticker.keywords ?? '').replace(/\bpropio\b/, 'empresa').slice(0, 300),
          content_type: p.sticker.content_type,
          image_data: p.sticker.image_data,
          size_bytes: p.sticker.size_bytes,
          created_by: revisor,
        },
        select: { id_sticker: true },
      });
      await tx.chatStickerPersonal.update({
        where: { id_sticker: idSticker },
        data: { proposal_state: 'aprobado', reviewed_by: revisor, reviewed_at: ahora, id_sticker_company: copia.id_sticker },
      });
    });
  });
}
