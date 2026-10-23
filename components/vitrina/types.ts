/** Tipos de las respuestas de /api/vitrina/** que usa la interfaz. */
import type { VisibilidadEfectiva } from '../../lib/vitrina/rules';

export interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canConsultar: boolean;
  canGestionar: boolean;
}

export interface BandejaItem {
  id: number;
  itemCode: string;
  itemName: string;
  grupo: number | null;
  /** Nombre del grupo de SAP («PT carbapenemas»); si no se ha leído, «Grupo 130». */
  grupoNombre: string | null;
  pais: string | null;
  canal: string;
  clienteMarca: string | null;
  activoEnSap: boolean;
  leidoEnSap: boolean;
  ultimaLectura: string | null;
  registroEstado: string;
  registroSanitario: string | null;
  registroVenceEn: string | null;
  sugerencia: {
    presentacion: string | null;
    familia: string | null;
    tipo: string | null;
    esParaTerceros: boolean | null;
    unidades: number | null;
    observacion: string | null;
  };
  productoRyan: string | null;
}

export interface BandejaResp {
  items: BandejaItem[];
  grupos: { codigo: number; nombre: string }[];
  paises: string[];
  gruposRyan: { producto: string; ids: number[]; avisos: string[] }[];
  totalBandeja: number;
}

export interface CodigoPresentacion {
  id: number;
  itemCode: string;
  itemName: string;
  grupoSap: string | null;
  pais: string | null;
  canal: string;
  visibilidadCanal: string;
  clienteMarca: string | null;
  activoEnSap: boolean;
  activado: boolean;
  registroEstado: string;
  registroSanitario: string | null;
  registroVenceEn: string | null;
  ultimaLectura: string | null;
  visibilidadEfectiva: VisibilidadEfectiva;
  motivos: string[];
}

export interface Presentacion {
  id: number;
  molecula: string;
  concentracion: string | null;
  formaFarmaceutica: string | null;
  unidadesCaja: number | null;
  nombreComercial: string | null;
  tallMan: string | null;
  familia: string | null;
  estado: string;
  visibilidad: string;
  esParaTerceros: boolean;
  destacada: boolean;
  areas: { id: number; nombre: string }[];
  linea: { id: number; nombre: string; activa: boolean } | null;
  grupos: { id: number; nombre: string }[];
  codigos: CodigoPresentacion[];
  faltantes: string[];
  activos: number;
  exclusividades: number;
  actualizadoEn: string;
}

/** Elemento de un catálogo administrable: servicio (área), línea comercial o grupo terapéutico. */
export interface Clasificacion {
  id: number;
  nombre: string;
  activa: boolean;
  orden: number;
  presentaciones: number;
}

export type Area = Clasificacion;

export interface Exclusividad {
  id: number;
  idPresentacion: number;
  presentacion: string;
  clienteBeneficiario: string;
  pais: string | null;
  canal: string | null;
  alcance: string;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  observacion: string | null;
  estado: 'VIGENTE' | 'POR_VENCER' | 'VENCIDA' | 'FUTURA';
}

export interface Alerta {
  tipo: string;
  nivel: 'alerta' | 'aviso' | 'info';
  titulo: string;
  detalle: string;
  idPresentacion: number | null;
}

export interface HistorialItem {
  id: string;
  entidad: string;
  idEntidad: number;
  accion: string;
  anterior: unknown;
  nuevo: unknown;
  usuario: string;
  registradoEn: string;
}
