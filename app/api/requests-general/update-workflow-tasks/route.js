import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();

    const { id_process, tasks } = body;

    if (!id_process) {
      return new Response(
        JSON.stringify({ error: 'ID del proceso es requerido' }),
        { status: 400 }
      );
    }

    if (!tasks || !Array.isArray(tasks)) {
      return new Response(
        JSON.stringify({ error: 'Lista de tareas es requerida' }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const results = [];

      for (const task of tasks) {
        const { id, task: taskName, active, cost, cost_center, id_user_assigned, action } = task;

        if (action === 'create') {
          // Crear nueva tarea
          if (!taskName || !taskName.trim()) {
            continue; // Saltar tareas sin nombre
          }

          const insertTaskQuery = `
            INSERT INTO task_process_category
            (task, id_process_category, active, cost, cost_center)
            OUTPUT INSERTED.id
            VALUES (@task, @id_process, @active, @cost, @cost_center)
          `;

          const taskRequest = new sql.Request(transaction);
          taskRequest.input('task', sql.NVarChar(1000), taskName);
          taskRequest.input('id_process', sql.Int, id_process);
          taskRequest.input('active', sql.Int, active !== undefined ? active : 1);
          taskRequest.input('cost', sql.Numeric(12, 0), cost || 0);
          taskRequest.input('cost_center', sql.NVarChar(1000), cost_center || null);

          const taskResult = await taskRequest.query(insertTaskQuery);
          const newTaskId = taskResult.recordset[0].id;

          // Asignar usuario a la tarea si existe
          if (id_user_assigned) {
            const insertUserTaskQuery = `
              INSERT INTO user_task_request_general
              (id_task, id_user)
              VALUES (@id_task, @id_user)
            `;

            await new sql.Request(transaction)
              .input('id_task', sql.Int, newTaskId)
              .input('id_user', sql.NVarChar(1000), id_user_assigned)
              .query(insertUserTaskQuery);
          }

          results.push({ action: 'create', id: newTaskId, success: true });

        } else if (action === 'update' && id) {
          // Actualizar tarea existente
          const updateTaskQuery = `
            UPDATE task_process_category
            SET
              task = @task,
              active = @active,
              cost = @cost,
              cost_center = @cost_center
            WHERE id = @id
          `;

          const taskRequest = new sql.Request(transaction);
          taskRequest.input('id', sql.Int, id);
          taskRequest.input('task', sql.NVarChar(1000), taskName);
          taskRequest.input('active', sql.Int, active !== undefined ? active : 1);
          taskRequest.input('cost', sql.Numeric(12, 0), cost || 0);
          taskRequest.input('cost_center', sql.NVarChar(1000), cost_center || null);

          await taskRequest.query(updateTaskQuery);

          // Actualizar usuario asignado
          // Primero eliminar asignación anterior
          const deleteUserTaskQuery = `
            DELETE FROM user_task_request_general
            WHERE id_task = @id_task
          `;

          await new sql.Request(transaction)
            .input('id_task', sql.Int, id)
            .query(deleteUserTaskQuery);

          // Insertar nueva asignación si hay usuario
          if (id_user_assigned) {
            const insertUserTaskQuery = `
              INSERT INTO user_task_request_general
              (id_task, id_user)
              VALUES (@id_task, @id_user)
            `;

            await new sql.Request(transaction)
              .input('id_task', sql.Int, id)
              .input('id_user', sql.NVarChar(1000), id_user_assigned)
              .query(insertUserTaskQuery);
          }

          results.push({ action: 'update', id, success: true });

        } else if (action === 'delete' && id) {
          // Eliminar tarea
          // Primero eliminar asignaciones de usuario
          const deleteUserTaskQuery = `
            DELETE FROM user_task_request_general
            WHERE id_task = @id_task
          `;

          await new sql.Request(transaction)
            .input('id_task', sql.Int, id)
            .query(deleteUserTaskQuery);

          // Luego eliminar la tarea
          const deleteTaskQuery = `
            DELETE FROM task_process_category
            WHERE id = @id
          `;

          await new sql.Request(transaction)
            .input('id', sql.Int, id)
            .query(deleteTaskQuery);

          results.push({ action: 'delete', id, success: true });
        }
      }

      await transaction.commit();

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Tareas procesadas correctamente',
          results,
        }),
        { status: 200 }
      );

    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en transacción:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al procesar las tareas',
          details: dbError.message,
        }),
        { status: 500 }
      );
    }

  } catch (err) {
    console.error('Error general:', err);
    return new Response(
      JSON.stringify({
        error: 'Error del servidor',
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
