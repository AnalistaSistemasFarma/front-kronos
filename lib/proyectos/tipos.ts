/**
 * Módulo «Proyectos» de SynerLink — contratos entre la API y la interfaz.
 *
 * Solo tipos (sin código de servidor): lo importan las rutas de
 * app/api/proyectos/** y los componentes de components/proyectos/**.
 * El porqué del diseño está en el encabezado de ChatProject (prisma/schema.prisma).
 */
import type { ProjectCapabilities, ProjectProfile, ProjectRole } from '../chat/projects-rules';

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
  updatedAt: string;
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
