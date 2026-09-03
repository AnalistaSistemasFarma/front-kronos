import { describe, expect, it } from 'vitest';
import { isSynerlinkWorkflowLocked } from '../workflowLock';

describe('workflowLock', () => {
  it('no bloquea por marcadores Orion en resolution', () => {
    expect(
      isSynerlinkWorkflowLocked({
        taskStatusId: 4,
        taskStatusLabel: 'Pendiente',
        taskResolution: '[orionFile:abc][orionAuth] Autorizar firma (a@test.com)',
        requestStatusReq: 1,
      })
    ).toBe(false);

    expect(
      isSynerlinkWorkflowLocked({
        taskStatusId: 4,
        taskStatusLabel: 'Pendiente',
        taskResolution: '[orionFile:abc] Pendiente de firma (b@test.com).',
        requestStatusReq: 1,
      })
    ).toBe(false);
  });

  it('bloquea tareas realmente cerradas por status', () => {
    expect(
      isSynerlinkWorkflowLocked({
        taskStatusId: 2,
        taskStatusLabel: 'Resuelto',
        taskResolution: 'Listo',
        requestStatusReq: 1,
      })
    ).toBe(true);
  });

  it('no bloquea solo por resolution Orion aunque status id sea null', () => {
    expect(
      isSynerlinkWorkflowLocked({
        taskStatusId: null,
        taskStatusLabel: 'Pendiente',
        taskResolution: '[orionFile:x][orionAuth] Autorizar firma (a@test.com)',
        requestStatusReq: 1,
      })
    ).toBe(false);
  });
});
