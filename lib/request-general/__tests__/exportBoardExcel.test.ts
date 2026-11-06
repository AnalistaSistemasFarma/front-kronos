import { describe, expect, it } from 'vitest';
import { buildBoardWorkbook, boardExportFilename } from '../exportBoardExcel';

describe('exportBoardExcel', () => {
  it('arma solicitudes, tareas pendientes y el resumen del filtro', async () => {
    const workbook = await buildBoardWorkbook({
      module: 'Mis solicitudes',
      filters: [{ label: 'Estado', value: 'Abierto' }],
      requests: [
        {
          id: 6038,
          subject: 'Contrato de servicio',
          process: 'Jurídica',
          category: 'Contratos',
          company: 'GSS',
          status: 'Abierto',
          requester: 'Ana',
          assigned: 'Luis',
          createdAt: '2026-10-15T15:00:00.000Z',
          tasks: [
            { id: 1, task: 'Revisar', status_task: 'Resuelto', id_status: 2, assigned: 'Luis' },
            { id: 2, task: 'Aprobar', status_task: 'Abierto', id_status: 1, assigned: 'Marta' },
          ],
        },
      ],
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen',
      'Solicitudes',
      'Tareas del proceso',
    ]);

    const solicitudes = workbook.getWorksheet('Solicitudes')!;
    expect(solicitudes.getRow(2).getCell('percent').value).toBe(50);
    expect(String(solicitudes.getRow(2).getCell('pending').value)).toContain('Aprobar (Abierto)');
    expect(String(solicitudes.getRow(2).getCell('taskPeople').value)).toBe('Luis, Marta');
    expect(solicitudes.autoFilter).toBeTruthy();

    const tareas = workbook.getWorksheet('Tareas del proceso')!;
    expect(tareas.rowCount).toBe(3);
    expect(tareas.getRow(3).getCell('assigned').value).toBe('Marta');
  });

  it('incluye la hoja de tareas asignadas cuando el filtro es de tareas', async () => {
    const workbook = await buildBoardWorkbook({
      module: 'Solicitudes y Tareas Asignadas',
      filters: [],
      assignedTasks: [
        {
          requestId: 10,
          taskId: 4,
          task: 'Firmar',
          subject: 'Acta',
          company: 'GSS',
          status: 'Sin empezar',
          assigned: 'Ana',
        },
      ],
    });

    expect(workbook.getWorksheet('Tareas asignadas')).toBeTruthy();
    expect(workbook.getWorksheet('Solicitudes')).toBeUndefined();
  });

  it('nombra el archivo con la fecha', () => {
    expect(boardExportFilename('Mis-solicitudes', new Date('2026-10-21T12:00:00.000Z'))).toBe(
      'Mis-solicitudes-2026-10-21.xlsx'
    );
  });
});