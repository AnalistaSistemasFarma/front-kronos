import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Renombrar y eliminar conversaciones de un proyecto (lib/proyectos/hilos.ts):
 * la reja (creador / dueño / administrador), el registro ANTES del cambio y el
 * borrado LÓGICO (archived = 1, nunca un DELETE de mensajes).
 */
const findConv = vi.hoisted(() => vi.fn());
const updateConv = vi.hoisted(() => vi.fn());
const updateManyConv = vi.hoisted(() => vi.fn());
const createLog = vi.hoisted(() => vi.fn());
const deleteMessages = vi.hoisted(() => vi.fn());
const admin = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => {
  const tx = {
    chatProjectConversationLog: { create: createLog },
    chatConversation: { update: updateConv, updateMany: updateManyConv },
    chatMessage: { deleteMany: deleteMessages },
  };
  return {
    prisma: {
      chatConversation: { findFirst: findConv },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock('../../access-control', () => ({ checkAdminPrivileges: admin }));

import { eliminarHilo, renombrarHilo } from '../hilos';
import type { ProjectAccess } from '../../chat/projects';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const proyecto = (over: Partial<ProjectAccess> = {}): ProjectAccess => ({
  idProject: 7,
  name: 'Comex',
  idCompany: 3,
  profile: 'olp',
  role: 'editor',
  archived: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue(false);
  findConv.mockResolvedValue({ id: 40, title: 'Viejo', created_by: 'u-ana' });
  createLog.mockResolvedValue({});
  updateConv.mockResolvedValue({});
  updateManyConv.mockResolvedValue({ count: 1 });
});

describe('renombrarHilo', () => {
  it('el creador renombra: registro primero, luego el título', async () => {
    const orden: string[] = [];
    createLog.mockImplementation(async () => orden.push('log'));
    updateConv.mockImplementation(async () => orden.push('update'));
    expect(await renombrarHilo(ANA, proyecto(), 40, '  Nuevo   nombre ')).toEqual({ idConversation: 40, title: 'Nuevo nombre' });
    expect(orden).toEqual(['log', 'update']);
    expect(createLog.mock.calls[0][0].data).toMatchObject({ id_project: 7, id_conversation: 40, action: 'renombrar', title_before: 'Viejo', title_after: 'Nuevo nombre', changed_by: 'u-ana' });
    // La búsqueda está anclada al proyecto de la puerta y a hilos activos.
    expect(findConv.mock.calls[0][0].where).toEqual({ id: 40, kind: 'project', id_project: 7, archived: false });
  });

  it('un editor que no lo creó y no es administrador: 403 y nada cambia', async () => {
    findConv.mockResolvedValue({ id: 40, title: 'Viejo', created_by: 'u-otro' });
    await expect(renombrarHilo(ANA, proyecto(), 40, 'X')).rejects.toMatchObject({ status: 403 });
    expect(createLog).not.toHaveBeenCalled();
    expect(updateConv).not.toHaveBeenCalled();
  });

  it('un administrador de SynerLink que no lo creó: sí', async () => {
    findConv.mockResolvedValue({ id: 40, title: 'Viejo', created_by: 'u-otro' });
    admin.mockResolvedValue(true);
    await renombrarHilo(ANA, proyecto(), 40, 'X');
    expect(updateConv).toHaveBeenCalled();
  });

  it('al dueño no se le pregunta si es administrador', async () => {
    findConv.mockResolvedValue({ id: 40, title: 'Viejo', created_by: 'u-otro' });
    await renombrarHilo(ANA, proyecto({ role: 'owner' }), 40, 'X');
    expect(admin).not.toHaveBeenCalled();
    expect(updateConv).toHaveBeenCalled();
  });

  it('título vacío: 400 sin consultar; hilo de otro proyecto o eliminado: 404', async () => {
    await expect(renombrarHilo(ANA, proyecto(), 40, '  ')).rejects.toMatchObject({ status: 400 });
    expect(findConv).not.toHaveBeenCalled();
    findConv.mockResolvedValue(null);
    await expect(renombrarHilo(ANA, proyecto(), 40, 'X')).rejects.toMatchObject({ status: 404 });
  });

  it('sin la tabla de registro (DDL pendiente): 503 y no se renombra', async () => {
    createLog.mockRejectedValue(Object.assign(new Error('The table `dbo.chat_project_conversation_log` does not exist'), { code: 'P2021' }));
    await expect(renombrarHilo(ANA, proyecto(), 40, 'X')).rejects.toMatchObject({ status: 503 });
    expect(updateConv).not.toHaveBeenCalled();
  });
});

describe('eliminarHilo (borrado lógico)', () => {
  it('el creador elimina: registro con quién y archived = 1; NUNCA borra mensajes', async () => {
    expect(await eliminarHilo(ANA, proyecto(), 40)).toEqual({ idConversation: 40, eliminada: true });
    expect(createLog.mock.calls[0][0].data).toMatchObject({ action: 'eliminar', changed_by: 'u-ana', title_before: 'Viejo' });
    expect(updateManyConv.mock.calls[0][0]).toEqual({ where: { id: 40, archived: false }, data: { archived: true } });
    expect(deleteMessages).not.toHaveBeenCalled();
  });

  it('el dueño elimina el hilo de otra persona', async () => {
    findConv.mockResolvedValue({ id: 40, title: 'Viejo', created_by: 'u-otro' });
    await eliminarHilo(ANA, proyecto({ role: 'owner' }), 40);
    expect(updateManyConv).toHaveBeenCalled();
  });

  it('un lector (aunque lo haya creado): 403', async () => {
    await expect(eliminarHilo(ANA, proyecto({ role: 'reader' }), 40)).rejects.toMatchObject({ status: 403 });
    expect(updateManyConv).not.toHaveBeenCalled();
  });

  it('proyecto archivado: 403, ni el dueño', async () => {
    await expect(eliminarHilo(ANA, proyecto({ role: 'owner', archived: true }), 40)).rejects.toMatchObject({ status: 403 });
    expect(admin).not.toHaveBeenCalled();
  });

  it('id basura: 400', async () => {
    await expect(eliminarHilo(ANA, proyecto(), 'abc')).rejects.toMatchObject({ status: 400 });
  });
});
