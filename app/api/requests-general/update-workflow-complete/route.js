import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      id_process,
      // Datos del proceso (opcionales)
      process,
      description,
      active,
      id_status,
      cost_center,
      id_user_assigned,
      // Datos de tareas (opcionales)
      tasks,
      // Flags para indicar qué actualizar
      updateProcess,
      updateTasks
    } = body;

    if (!id_process) {
      return new Response(
        JSON.stringify({ error: 'ID del proceso es requerido' }),
        { status: 400 }
      );
    }

    // Determinar qué actualizar basándose en los flags o en la presencia de datos
    const shouldUpdateProcess = updateProcess !== false && (process !== undefined || id_user_assigned !== undefined);
    const shouldUpdateTasks = updateTasks !== false && tasks && Array.isArray(tasks) && tasks.length > 0;

    if (!shouldUpdateProcess && !shouldUpdateTasks) {
      return new Response(
        JSON.stringify({ error: 'No hay datos para actualizar. Proporcione datos del proceso o tareas.' }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const results = {
        process: null,
        tasks: []
      };

      // Actualizar proceso si es necesario
      if (shouldUpdateProcess) {
        // Validar datos requeridos para actualizar proceso
        if (process !== undefined && (!process || !process.trim())) {
          await transaction.rollback();
          return new Response(
            JSON.stringify({ error: 'El nombre del proceso no puede estar vacío' }),
            { status: 400 }
          );
        }

        if (id_user_assigned !== undefined && !id_user_assigned) {
          await transaction.rollback();
          return new Response(
            JSON.stringify({ error: 'El usuario asignado es requerido para el proceso' }),
            { status: 400 }
          );
        }

        // Construir query de actualización dinámicamente
        const updateFields = [];
        const processRequest = new sql.Request(transaction);
        processRequest.input('id_process', sql.Int, id_process);

        if (process !== undefined) {
          updateFields.push('process = @process');
          processRequest.input('process', sql.NVarChar(1000), process);
        }

        if (description !== undefined) {
          updateFields.push('description = @description');
          processRequest.input('description', sql.NVarChar(sql.MAX), description || null);
        }

        if (active !== undefined) {
          updateFields.push('active = @active');
          processRequest.input('active', sql.Int, active);
        }

        if (id_status !== undefined) {
          updateFields.push('id_status = @id_status');
          processRequest.input('id_status', sql.Int, id_status);
        }

        if (cost_center !== undefined) {
          updateFields.push('cost_center = @cost_center');
          processRequest.input('cost_center', sql.NVarChar(1000), cost_center || null);
        }

        // Ejecutar actualización del proceso si hay campos para actualizar
        if (updateFields.length > 0) {
          const updateProcessQuery = `
            UPDATE process_category
            SET ${updateFields.join(', ')}
            WHERE id = @id_process
          `;

          await processRequest.query(updateProcessQuery);
        }

        // Actualizar usuario asignado al proceso si se proporciona
        if (id_user_assigned !== undefined) {
          const deleteAssignedQuery = `
            DELETE FROM user_process_category_request_general
            WHERE id_process_category = @id_process
          `;

          await new sql.Request(transaction)
            .input('id_process', sql.Int, id_process)
            .query(deleteAssignedQuery);

          const insertAssignedQuery = `
            INSERT INTO user_process_category_request_general
            (id_process_category, id_user)
            VALUES (@id_process, @id_user)
          `;

          await new sql.Request(transaction)
            .input('id_process', sql.Int, id_process)
            .input('id_user', sql.NVarChar(1000), id_user_assigned)
            .query(insertAssignedQuery);
        }

        results.process = { success: true };
      }

      // Actualizar tareas si es necesario
      if (shouldUpdateTasks) {
        for (const task of tasks) {
          const { id, task: taskName, active: taskActive, cost, cost_center: taskCostCenter, id_user_assigned: taskUserAssigned, action } = task;

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
            taskRequest.input('active', sql.Int, taskActive !== undefined ? taskActive : 1);
            taskRequest.input('cost', sql.Numeric(12, 0), cost || 0);
            taskRequest.input('cost_center', sql.NVarChar(1000), taskCostCenter || null);

            const taskResult = await taskRequest.query(insertTaskQuery);
            const newTaskId = taskResult.recordset[0].id;

            // Asignar usuario a la tarea si existe
            if (taskUserAssigned) {
              const insertUserTaskQuery = `
                INSERT INTO user_task_request_general
                (id_task, id_user)
                VALUES (@id_task, @id_user)
              `;

              await new sql.Request(transaction)
                .input('id_task', sql.Int, newTaskId)
                .input('id_user', sql.NVarChar(1000), taskUserAssigned)
                .query(insertUserTaskQuery);
            }

            results.tasks.push({ action: 'create', id: newTaskId, success: true });

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
            taskRequest.input('active', sql.Int, taskActive !== undefined ? taskActive : 1);
            taskRequest.input('cost', sql.Numeric(12, 0), cost || 0);
            taskRequest.input('cost_center', sql.NVarChar(1000), taskCostCenter || null);

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
            if (taskUserAssigned) {
              const insertUserTaskQuery = `
                INSERT INTO user_task_request_general
                (id_task, id_user)
                VALUES (@id_task, @id_user)
              `;

              await new sql.Request(transaction)
                .input('id_task', sql.Int, id)
                .input('id_user', sql.NVarChar(1000), taskUserAssigned)
                .query(insertUserTaskQuery);
            }

            results.tasks.push({ action: 'update', id, success: true });

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

            results.tasks.push({ action: 'delete', id, success: true });
          }
        }
      }

      await transaction.commit();

      // Construir mensaje de respuesta
      const messages = [];
      if (shouldUpdateProcess) {
        messages.push('Proceso actualizado correctamente');
      }
      if (shouldUpdateTasks && results.tasks.length > 0) {
        messages.push(`${results.tasks.length} tarea(s) procesada(s) correctamente`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: messages.join('. '),
          results,
          updated: {
            process: shouldUpdateProcess,
            tasks: shouldUpdateTasks
          }
        }),
        { status: 200 }
      );

    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en transacción:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al actualizar',
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
