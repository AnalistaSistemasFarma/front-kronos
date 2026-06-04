export interface DashboardTask {
  id_tarea: number;
  tarea: string;
  estado_tarea: string;
  asignado_tarea: string;
  hora_inicio_tarea: string | null;
  fecha_fin_tarea: string | null;
  resolucion_tarea: string | null;
  fecha_resolucion_tarea: string | null;
  costo_tarea: number | null;
  centro_costo_tarea: string | null;
  activo_tarea: boolean;
  ejecutor_final_tarea: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  descripcion_solicitud: string;
  fecha_creacion_solicitud: string;
  empresa_solicitud: string;
  creador_solicitud: string;
  estado_solicitud: string;
  resolucion_solicitud: string | null;
  fecha_resolucion_solicitud: string | null;
  ejecutor_final_solicitud: string | null;
  proceso_solicitud: string;
  categoria_solicitud: string;
  encargado_proceso?: string | null;
}

export type DashboardRequest = Pick<
  DashboardTask,
  | 'id_solicitud'
  | 'asunto_solicitud'
  | 'descripcion_solicitud'
  | 'fecha_creacion_solicitud'
  | 'empresa_solicitud'
  | 'creador_solicitud'
  | 'estado_solicitud'
  | 'resolucion_solicitud'
  | 'fecha_resolucion_solicitud'
  | 'ejecutor_final_solicitud'
  | 'proceso_solicitud'
  | 'categoria_solicitud'
>;
