import 'server-only';
import { getChatAccess } from '../chat/access';
import { prisma } from '../prisma';
import type { AgentePort } from './agente';

/**
 * Dependencias REALES de «Consultar a un agente»: la base y el MISMO permiso del chat
 * (getChatAccess: subproceso del agente en una empresa a la que el agente pertenece).
 */
export function agentePort(): AgentePort {
  return {
    db: prisma,
    agentesDe: async (email) => {
      const acceso = await getChatAccess(email);
      if (!acceso.canUseChat) return [];
      return acceso.agents.map((a) => ({
        idAgent: a.idAgent,
        code: a.code,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        avatarVersion: a.avatarVersion,
        description: a.description,
      }));
    },
  };
}
