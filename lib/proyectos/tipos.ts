/**
 * Módulo «Proyectos» de SynerLink — contratos entre la API y la interfaz.
 *
 * Solo tipos (sin código de servidor): lo importan las rutas de
 * app/api/proyectos/** y los componentes de components/proyectos/**.
 * El porqué del diseño está en el encabezado de ChatProject (prisma/schema.prisma).
 */
import type { ProjectCapabilities, ProjectProfile, ProjectRole } from '../chat/projects-rules';
import type { EstadoAgenteProyectoDto } from './estado-agente';

export type { ProjectCapabilities, ProjectRole };

export interface EmpresaDto {
  idCompany: number;
  companyName: string;
}

export interface PersonaDto {
  id: string;
  name: string;
}

/** Lo mínimo para pintar un agente (avatar y nombre). */
export interface AgenteMiniDto {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarVersion: number | null;
}

/** Agente que el dueño PUEDE designar en una empresa, con los perfiles que admite. */
export interface AgenteDesignableDto extends AgenteMiniDto {
  profiles: string[];
  /** Agente de DESARROLLO (2026-10-27): solo a estos se les ofrece código y repos. */
  esDesarrollo?: boolean;
}

/** Agente designado en un proyecto, visto por ESTA persona. */
export interface AgenteProyectoDto extends AgenteMiniDto {
  /** Sigue designado, activo y con el módulo habilitado. */
  disponible: boolean;
  /** Esta persona le puede escribir (rol + permiso del agente en la empresa). */
  puedoEscribir: boolean;
  /** Si no puede, por qué (texto para la interfaz). */
  motivo: string | null;
}

export interface ProyectoResumenDto {
  idProject: number;
  name: string;
  description: string | null;
  company: EmpresaDto;
  profile: { key: string; label: string };
  myRole: ProjectRole;
  archived: boolean;
  agents: AgenteMiniDto[];
  memberCount: number;
  conversationCount: number;
  linkCount: number;
  fileCount: number;
  /** Tareas del cronograma (2026-10-18). */
  taskCount: number;
  updatedAt: string;
  /**
   * Agentes trabajando AHORA en sus conversaciones (2026-10-20). Opcional: una
   * respuesta vieja no lo trae y la tarjeta simplemente no lo pinta. Lo que
   * cambie después llega por el pulso del chat.
   */
  trabajando?: EstadoAgenteProyectoDto[];
}

export interface ListaProyectosDto {
  /** Empresas donde la persona tiene el módulo (donde puede crear). */
  companies: EmpresaDto[];
  /** Por empresa (clave = idCompany en texto): agentes que puede designar. */
  designables: Record<string, AgenteDesignableDto[]>;
  profiles: ProjectProfile[];
  projects: ProyectoResumenDto[];
}

export interface MiembroDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: ProjectRole;
}

export interface ArchivoDto {
  id: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: PersonaDto | null;
  /** Lo generó un agente en una conversación del proyecto (2026-10-23). */
  uploadedByAgent: { idAgent: number; name: string; idConversation: number | null } | null;
  downloadUrl: string;
  puedoQuitar: boolean;
}

export interface ConversacionDto {
  id: number;
  title: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  agent: AgenteMiniDto;
  createdBy: PersonaDto | null;
  /** Null = se puede escribir. Si no, el motivo (rol, agente retirado…). */
  soloLectura: string | null;
  /**
   * Estado del agente en esta conversación al cargar (2026-10-20): el mismo
   * indicador del chat. Null = nunca reportó nada. Lo que cambie después llega
   * por el pulso del chat.
   */
  agentStatus?: EstadoAgenteProyectoDto | null;
}

export interface CorreoVinculadoDto {
  id: number;
  subject: string;
  senderName: string | null;
  senderEmail: string | null;
  lastMessageAt: string | null;
  messageCount: number | null;
  summary: string | null;
  linkedBy: PersonaDto | null;
  linkedAt: string;
  /** Solo para quien lo vinculó: abre el hilo en SU módulo Correo. */
  abrirUrl: string | null;
  puedoQuitar: boolean;
}

export interface SolicitudVinculadaDto {
  id: number;
  idRequest: number;
  subject: string;
  processName: string | null;
  companyName: string | null;
  /** Estado actual del caso (vivo), si se pudo leer. */
  estado: string | null;
  linkedBy: PersonaDto | null;
  linkedAt: string;
  /** El caso en SynerLink: al abrirlo, SynerLink vuelve a validar el permiso. */
  url: string;
  puedoQuitar: boolean;
}

export interface ProyectoDetalleDto extends ProyectoResumenDto {
  instructions: string | null;
  createdAt: string;
  capabilities: ProjectCapabilities;
  agents: AgenteProyectoDto[];
  members: MiembroDto[];
  files: ArchivoDto[];
  conversations: ConversacionDto[];
  links: { emails: CorreoVinculadoDto[]; requests: SolicitudVinculadaDto[] };
  /** Subagentes APROBADOS del equipo (F2, 2026-10-18). */
  teamCount: number;
}

/** Un hilo del buzón PROPIO, para escoger cuál vincular. */
export interface HiloElegibleDto {
  conversationId: string;
  subject: string;
  senderName: string | null;
  senderEmail: string | null;
  lastMessageAt: string | null;
  extracto: string | null;
  yaVinculado: boolean;
}

/** Una solicitud que la persona ve, para escoger cuál vincular. */
export interface SolicitudElegibleDto {
  idRequest: number;
  subject: string;
  processName: string | null;
  estado: string | null;
  createdAt: string | null;
  yaVinculada: boolean;
}

export interface CandidatoDto {
  id: string;
  name: string;
  email: string;
}

/* ───────────────────────────── Cronograma (2026-10-18) ───────────────────────────── */

export interface TareaDto {
  id: number;
  title: string;
  description: string | null;
  responsible: PersonaDto | null;
  /** AAAA-MM-DD (fecha de calendario). */
  startDate: string;
  endDate: string;
  status: 'pendiente' | 'en_curso' | 'hecha' | 'bloqueada';
  progress: number | null;
  isMilestone: boolean;
  /** 'agente' = la propuso un asistente y una persona la confirmó. */
  origin: 'persona' | 'agente';
  createdBy: PersonaDto | null;
  createdAt: string;
  updatedBy: PersonaDto | null;
  updatedAt: string | null;
  puedoEditar: boolean;
  puedoBorrar: boolean;
}

/** Actividad del workflow de una solicitud (task_request_general), como sub-ítem. */
export interface ActividadSolicitudDto {
  id: number;
  task: string;
  idStatus: number | null;
  status: string | null;
  assignedTo: string | null;
  startDate: string | null;
  endDate: string | null;
  resolvedAt: string | null;
}

export interface SolicitudCronogramaDto {
  /** Id del vínculo (chat_project_request). */
  idLink: number;
  idRequest: number;
  subject: string;
  processName: string | null;
  /** Estado vivo del caso. */
  estado: string | null;
  idStatus: number | null;
  createdAt: string | null;
  resolvedAt: string | null;
  /** Fecha objetivo que le puso el proyecto (el «vencimiento»). */
  targetDate: string | null;
  url: string;
  linkedBy: PersonaDto | null;
  actividades: ActividadSolicitudDto[];
  puedoFijarFecha: boolean;
  puedoQuitar: boolean;
}

export interface PropuestaDto {
  id: number;
  kind: string;
  kindLabel: string;
  summary: string;
  source: 'puente' | 'mcp';
  agent: AgenteMiniDto | null;
  requestedFor: PersonaDto | null;
  createdAt: string;
  expiresAt: string;
  puedoConfirmar: boolean;
  motivo: string | null;
}

export interface CronogramaDto {
  /** Hoy en Bogotá (AAAA-MM-DD): la línea roja del Gantt. */
  hoy: string;
  tasks: TareaDto[];
  requests: SolicitudCronogramaDto[];
  /** Miembros que pueden ser responsables. */
  members: PersonaDto[];
  capabilities: { crear: boolean; vincular: boolean; fijarFecha: boolean };
  proposals: PropuestaDto[];
  /** Avisos no fatales (p. ej. no se pudo leer el estado vivo de las solicitudes). */
  avisos: string[];
}

export interface EventoAuditoriaDto {
  id: number;
  action: string;
  detail: string;
  by: PersonaDto | null;
  agent: string | null;
  via: string;
  at: string;
}

/** Concesión de 24 h para gestionar Proyectos desde un asistente (kronos-mcp). */
export interface ConcesionProyectoDto {
  id: number;
  agent: AgenteMiniDto;
  /** null = todos los proyectos de la persona. */
  project: { idProject: number; name: string } | null;
  createdAt: string;
  expiresAt: string;
  idChatConversation: number;
}

/* ─────────────── Equipo de subagentes (F2, 2026-10-18) ─────────────── */

export type HerramientaEquipoDto = 'archivos' | 'trabajo' | 'web' | 'conectores';
export type ModeloSubagenteDto = 'haiku' | 'sonnet' | 'opus';

export interface SubagenteDto {
  id: number;
  /** Identificador que usa el asistente (`subagent_type`). */
  slug: string;
  name: string;
  purpose: string;
  instructions: string | null;
  tools: HerramientaEquipoDto[];
  /** null = el del asistente principal. */
  model: ModeloSubagenteDto | null;
  status: 'propuesto' | 'aprobado' | 'descartado';
  origin: 'agente' | 'persona';
  /** Asistente que lo sugirió. */
  suggestedBy: string | null;
  createdAt: string;
  reviewedBy: PersonaDto | null;
  reviewedAt: string | null;
  /** Últimos 30 días. */
  uso30d: { corridas: number; tokens: number; ultima: string | null };
}

export interface PedidoEquipoDto {
  id: number;
  status: 'pendiente' | 'en_curso' | 'lista' | 'fallida' | 'vencida';
  requestedAt: string;
  finishedAt: string | null;
  requestedBy: PersonaDto | null;
  agent: AgenteMiniDto | null;
  error: string | null;
  suggested: number;
}

/** Lo que hizo un subagente en un turno (lo reporta el puente). */
export interface CorridaSubagenteDto {
  id: number;
  slug: string;
  name: string;
  description: string;
  status: 'ok' | 'error' | 'cancelado';
  conversation: { id: number; title: string | null } | null;
  startedAt: string;
  durationMs: number | null;
  totalTokens: number;
  toolUses: number;
  model: string | null;
}

export interface EquipoDto {
  /** El dueño puede apagar el equipo sin borrarlo. */
  enabled: boolean;
  /** Subagentes a la vez (el puente lo acota con su propio tope). */
  maxParallel: number;
  topeMaximo: number;
  /** Siempre 1: los subagentes no lanzan otros. */
  profundidad: number;
  maxEquipo: number;
  /** Herramientas del catálogo que admite el perfil del proyecto. */
  disponibles: HerramientaEquipoDto[];
  profileLabel: string;
  capacidades: { ver: boolean; sugerir: boolean; aprobar: boolean; configurar: boolean };
  /** ¿El editor también aprueba? (PROYECTOS_EQUIPO_EDITOR_APRUEBA). */
  editorAprueba: boolean;
  /** Asistentes con los que ESTA persona puede pedir una sugerencia. */
  sugeridores: AgenteMiniDto[];
  members: SubagenteDto[];
  /** El pedido de «Sugerir equipo» más reciente. */
  pedido: PedidoEquipoDto | null;
  corridas: CorridaSubagenteDto[];
  consumo30d: { corridas: number; tokens: number };
}
