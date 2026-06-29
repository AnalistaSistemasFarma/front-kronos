// @ts-check
/**
 * Seed del módulo Organigrama (SynerLink).
 *
 * Siembra:
 *   1. El catálogo maestro de cargos (~150) — sección 3 de la investigación
 *      `organigrama-cargos-seed.md`, con su nivel (Estratégico/Táctico/Operativo).
 *   2. La jerarquía de reporte POR EMPRESA para Farmalógica (4.1) y Ryan (4.2).
 *
 * Diseño:
 *   - cargo_id ESTABLE + tabla de alias (cargo_alias): renombrar un cargo no
 *     rompe la historia. Aquí solo sembramos el catálogo; los alias quedan
 *     listos para poblarse cuando se documenten renombramientos.
 *   - jerarquía SCOPED por empresa (cargo_jerarquia): el mismo cargo reporta
 *     distinto en Farmalógica que en Ryan.
 *   - Donde el organigrama no permite inferir el parent con certeza,
 *     `aproximada = true`.
 *
 * Propiedades:
 *   - IDEMPOTENTE: usa upsert por claves únicas (nombre_normalizado y
 *     [id_company, id_cargo]). Correrlo dos veces NO duplica.
 *   - APPEND-ONLY: nunca borra (sin DELETE).
 *   - Si no encuentra una empresa por nombre, lo registra y salta esa parte
 *     SIN fallar.
 *
 * Cómo correrlo (requiere DATABASE_URL en el entorno):
 *   node prisma/seeds/organigrama.mjs
 *
 * NOTA: este seed NO se ha ejecutado contra ninguna base de datos todavía.
 */

import { PrismaClient } from '../../app/generated/prisma/index.js'

const prisma = new PrismaClient()

/**
 * Normaliza un nombre de cargo para usarlo como clave estable:
 * - recorta espacios y colapsa espacios internos
 * - quita acentos (NFD) para comparar de forma consistente
 * - pasa a MAYÚSCULAS
 * El valor guardado en `nombre_normalizado` es esta forma normalizada.
 * @param {string} s
 */
function normalizar(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * Catálogo de cargos — sección 3.
 * Cada entrada: [nombre legible (display), nivel].
 * El `nombre_normalizado` se deriva con normalizar(display).
 * @type {Array<[string, 'Estratégico'|'Táctico'|'Operativo']>}
 */
const CATALOGO = [
  // 3.1 Estratégico
  ['Junta Directiva', 'Estratégico'],
  ['Gerente General', 'Estratégico'],
  ['Gerente Suplente', 'Estratégico'],
  ['Revisor Fiscal', 'Estratégico'],
  ['Director Administrativo', 'Estratégico'],
  ['Director Financiero', 'Estratégico'],
  ['Director de Operaciones y Finanzas', 'Estratégico'],
  ['Director Técnico', 'Estratégico'],
  ['Director de Planta', 'Estratégico'],
  ['Director de Mercadeo', 'Estratégico'],
  ['Director de Garantía de Calidad y Responsable Técnico de Laboratorio', 'Estratégico'],
  ['Director de Control de Calidad - Fisicoquímico', 'Estratégico'],
  ['Director de Microbiología', 'Estratégico'],
  ['Director de Validaciones', 'Estratégico'],
  ['Director de Garantía de Calidad', 'Estratégico'],
  ['Director de Abastecimiento y Comercio Exterior', 'Estratégico'],
  ['Director de Talento Humano', 'Estratégico'],
  ['Director Comercial', 'Estratégico'],
  ['Director de Negocios Especiales', 'Estratégico'],
  ['Director de Ingeniería', 'Estratégico'],
  ['Director de Producción', 'Estratégico'],
  ['Dirección Administrativa', 'Estratégico'],
  ['Dirección de Operaciones', 'Estratégico'],
  ['Director Aseguramiento de Calidad Nacional', 'Estratégico'],
  ['Gerente Técnico Regulatorio', 'Estratégico'],
  ['Gerente de Manufactura', 'Estratégico'],
  ['Gerente de Calidad', 'Estratégico'],
  ['Gerente de Control', 'Estratégico'],
  ['Gerente Comercial y de Mercadeo', 'Estratégico'],
  ['Gerente de Operaciones y Finanzas', 'Estratégico'],
  ['Gerente de Talento Humano', 'Estratégico'],
  ['Gerente de Planeación', 'Estratégico'],
  ['Gerente de Mantenimiento', 'Estratégico'],
  ['Gerente de Abastecimiento y Comercio Exterior', 'Estratégico'],
  ['Sub Gerencia Técnica', 'Estratégico'],

  // 3.2 Táctico — Jefaturas
  ['Jefe de Compras', 'Táctico'],
  ['Jefe de Contabilidad', 'Táctico'],
  ['Jefe de Crédito y Cartera', 'Táctico'],
  ['Jefe de Talento Humano', 'Táctico'],
  ['Jefe de Selección y Bienestar', 'Táctico'],
  ['Jefe de SST', 'Táctico'],
  ['Jefe de Mantenimiento', 'Táctico'],
  ['Jefe de Control de Calidad', 'Táctico'],
  ['Jefe de Microbiología', 'Táctico'],
  ['Jefe de Garantía de Calidad', 'Táctico'],
  ['Jefe de Validaciones', 'Táctico'],
  ['Jefe de Asuntos Regulatorios', 'Táctico'],
  ['Jefe de Documentación Técnica', 'Táctico'],
  ['Jefe de Investigación y Desarrollo', 'Táctico'],
  ['Jefe de Estabilidades', 'Táctico'],
  ['Jefe de Farmacovigilancia', 'Táctico'],
  ['Jefe de Ventas', 'Táctico'],
  ['Jefe de Ventas Exterior', 'Táctico'],
  ['Jefe de Línea', 'Táctico'],
  ['Jefe de Finales de Línea', 'Táctico'],
  ['Jefe de Nuevos Productos', 'Táctico'],
  ['Jefe de Comercio Exterior', 'Táctico'],
  ['Jefe Jurídico', 'Táctico'],
  ['Jefe de Infraestructura', 'Táctico'],
  ['Jefe de Planeación', 'Táctico'],
  ['Jefe de Producción', 'Táctico'],
  ['Jefe de Gestión Humana y SST', 'Táctico'],
  ['Jefe Nacional de Inventarios', 'Táctico'],
  ['Jefe de Sistemas', 'Táctico'],
  // 3.2 Táctico — Coordinaciones
  ['Coordinador de Compras', 'Táctico'],
  ['Coordinador de Contabilidad', 'Táctico'],
  ['Coordinador de Costos e Inventario', 'Táctico'],
  ['Coordinador Administrativo', 'Táctico'],
  ['Coordinador de Talento Humano', 'Táctico'],
  ['Coordinador de Nómina y Contratación', 'Táctico'],
  ['Coordinador de Formación y Calificación de Personal', 'Táctico'],
  ['Coordinador de Selección y Desarrollo', 'Táctico'],
  ['Coordinador de Seguridad y Salud en el Trabajo (SST)', 'Táctico'],
  ['Coordinador de Sistemas', 'Táctico'],
  ['Coordinador de Desarrollo', 'Táctico'],
  ['Coordinador de Estabilidades', 'Táctico'],
  ['Coordinador de Cumplimiento Regulatorio y Gestión de Artes', 'Táctico'],
  ['Coordinador de Asuntos Regulatorios', 'Táctico'],
  ['Coordinador de Validaciones', 'Táctico'],
  ['Coordinador de Control de Calidad', 'Táctico'],
  ['Coordinador de Calidad', 'Táctico'],
  ['Coordinador de Garantía de Calidad y Gestión Ambiental', 'Táctico'],
  ['Coordinador de Microbiología', 'Táctico'],
  ['Coordinador de Mejoramiento Continuo', 'Táctico'],
  ['Coordinador de Producción', 'Táctico'],
  ['Coordinador de Acondicionamiento', 'Táctico'],
  ['Coordinador de Planeación', 'Táctico'],
  ['Coordinador de Comercio Exterior', 'Táctico'],
  ['Coordinador Bodega General', 'Táctico'],
  ['Coordinador de Diseño Gráfico', 'Táctico'],
  ['Coordinador Institucional', 'Táctico'],
  ['Coordinador de Investigación y Desarrollo', 'Táctico'],
  ['Coordinador de Reporte y Control', 'Táctico'],
  ['Coordinador de Facturación y Cartera', 'Táctico'],
  ['Coordinador de Farmacovigilancia', 'Táctico'],
  ['Coordinador de Implementación de Software', 'Táctico'],
  ['Coordinador de Operaciones', 'Táctico'],
  ['Oficial de Cumplimiento', 'Táctico'],

  // 3.3 Operativo
  ['Profesional en Seguridad y Salud en el Trabajo', 'Operativo'],
  ['Especialista Senior Institucional', 'Operativo'],
  ['Especialista en Compras / Comercio Exterior', 'Operativo'],
  ['Project Manager', 'Operativo'],
  ['Formulador Galénico', 'Operativo'],
  ['Supervisor', 'Operativo'],
  ['Supervisor de Mantenimiento', 'Operativo'],
  ['Supervisor Logístico', 'Operativo'],
  ['Supervisor de Planta / Producción', 'Operativo'],
  ['Supervisor de Almacén', 'Operativo'],
  ['Supervisor de Operaciones', 'Operativo'],
  ['Supervisor de Estabilidades', 'Operativo'],
  ['Inspector de Calidad', 'Operativo'],
  ['Inspector de Calidad Planta', 'Operativo'],
  ['Inspector Garantía de Calidad', 'Operativo'],
  ['Tecnólogo de Control de Calidad', 'Operativo'],
  ['Técnico de Mantenimiento', 'Operativo'],
  ['Diseñador Gráfico', 'Operativo'],
  ['Representante de Ventas', 'Operativo'],
  ['Analista Contable', 'Operativo'],
  ['Analista de Contabilidad', 'Operativo'],
  ['Analista de Costos', 'Operativo'],
  ['Analista de Tesorería', 'Operativo'],
  ['Analista Capital de Trabajo', 'Operativo'],
  ['Analista Data Análisis', 'Operativo'],
  ['Analista de Desarrollo', 'Operativo'],
  ['Analista Jurídico', 'Operativo'],
  ['Analista Administrativo', 'Operativo'],
  ['Analista de Compras', 'Operativo'],
  ['Analista de Comercio Exterior', 'Operativo'],
  ['Analista de Mercadeo', 'Operativo'],
  ['Analista de Servicio al Cliente', 'Operativo'],
  ['Analista de Pedidos y Facturación', 'Operativo'],
  ['Analista de Facturación', 'Operativo'],
  ['Analista de Materiales', 'Operativo'],
  ['Analista de Producción', 'Operativo'],
  ['Analista de Mantenimiento', 'Operativo'],
  ['Analista de Ingeniería', 'Operativo'],
  ['Analista de Calidad', 'Operativo'],
  ['Analista de Garantía de Calidad', 'Operativo'],
  ['Analista de Control de Calidad', 'Operativo'],
  ['Analista de Material Envase y Empaque de Control de Calidad', 'Operativo'],
  ['Analista de Producto Terminado', 'Operativo'],
  ['Analista de Microbiología', 'Operativo'],
  ['Analista de Validaciones', 'Operativo'],
  ['Analista de Aseguramiento Metrológico', 'Operativo'],
  ['Analista de Estabilidades', 'Operativo'],
  ['Analista de Asuntos Regulatorios', 'Operativo'],
  ['Analista de Asuntos Regulatorios y Farmacovigilancia', 'Operativo'],
  ['Analista de Farmacovigilancia', 'Operativo'],
  ['Analista de Investigación y Desarrollo', 'Operativo'],
  ['Analista de Nómina y Contratación', 'Operativo'],
  ['Analista de Selección y Bienestar', 'Operativo'],
  ['Analista de Formación y Calificación', 'Operativo'],
  ['Analista de SST', 'Operativo'],
  ['Analista de Talento Humano', 'Operativo'],
  ['Analista de Gestión de Calidad', 'Operativo'],
  ['Analista de Inventarios', 'Operativo'],
  ['Analista de Infraestructura', 'Operativo'],
  ['Analista Senior SST', 'Operativo'],
  ['Asistente General', 'Operativo'],
  ['Asistente de Producción', 'Operativo'],
  ['Asistente de Gestión Humana', 'Operativo'],
  ['Asistente de Garantía de Calidad', 'Operativo'],
  ['Asistente de Software y Tecnología', 'Operativo'],
  ['Planeador', 'Operativo'],
  ['Conductor', 'Operativo'],
  ['Mensajero', 'Operativo'],
  ['Químico Farmacéutico de Calidad / Planta / Interpretación', 'Operativo'],
  ['Regente de Planta (RF Planta)', 'Operativo'],
  ['Auxiliar Administrativo', 'Operativo'],
  ['Auxiliar Administrativo y Oficios Varios de Producción', 'Operativo'],
  ['Auxiliar Contable', 'Operativo'],
  ['Auxiliar de Producción', 'Operativo'],
  ['Auxiliar de Fabricación', 'Operativo'],
  ['Auxiliar de Autoclave y Fabricación', 'Operativo'],
  ['Auxiliar de Ingeniería', 'Operativo'],
  ['Auxiliar de Mantenimiento', 'Operativo'],
  ['Auxiliar de Soporte Tecnológico', 'Operativo'],
  ['Auxiliar de Servicios Generales', 'Operativo'],
  ['Auxiliar de Vigilancia', 'Operativo'],
  ['Auxiliar de Recepción', 'Operativo'],
  ['Auxiliar de Servicio al Cliente', 'Operativo'],
  ['Auxiliar de Compras', 'Operativo'],
  ['Auxiliar Comercial', 'Operativo'],
  ['Auxiliar de Almacén', 'Operativo'],
  ['Auxiliar Almacén de Producción', 'Operativo'],
  ['Auxiliar de Controles en Proceso', 'Operativo'],
  ['Auxiliar de Oficina - Garantía de Calidad', 'Operativo'],
  ['Auxiliar de Microbiología', 'Operativo'],
  ['Auxiliar de Muestreo de Control de Calidad', 'Operativo'],
  ['Auxiliar de Cadena de Custodia', 'Operativo'],
  ['Auxiliar de Control de Calidad', 'Operativo'],
  ['Auxiliar de Documentación', 'Operativo'],
  ['Auxiliar de Diseño', 'Operativo'],
  ['Auxiliar de Desarrollo', 'Operativo'],
  ['Auxiliar de Digitalización Documental', 'Operativo'],
  ['Auxiliar de Talento Humano', 'Operativo'],
  ['Auxiliar SST', 'Operativo'],
  ['Auxiliar de Distribución', 'Operativo'],
  ['Auxiliar de Calidad', 'Operativo'],
  ['Auxiliar de Transporte', 'Operativo'],
  ['Auxiliar de Aseo', 'Operativo'],
  ['Auxiliar de Licitaciones', 'Operativo'],
]

/**
 * Jerarquía Farmalógica (sección 4.1).
 * Pares [hijo, padre]. padre = null => raíz.
 * El segundo elemento de cada tupla con `true` marca la relación como aproximada.
 * Todos los cargos referenciados deben existir en CATALOGO (normalizados).
 * @type {Array<[string, string|null, boolean?]>}
 */
const JERARQUIA_FARMALOGICA = [
  ['Gerente General', null],
  ['Director Administrativo', 'Gerente General'],
  ['Coordinador de Estabilidades', 'Director Administrativo', true],
  ['Director Técnico', 'Gerente General'],
  ['Coordinador de Asuntos Regulatorios', 'Director Técnico'],
  ['Analista de Asuntos Regulatorios', 'Coordinador de Asuntos Regulatorios'],
  ['Coordinador de Farmacovigilancia', 'Director Técnico'],
  ['Director de Abastecimiento y Comercio Exterior', 'Gerente General'],
  ['Jefe de Compras', 'Director de Abastecimiento y Comercio Exterior'],
  ['Analista de Compras', 'Jefe de Compras'],
  ['Auxiliar de Compras', 'Jefe de Compras'],
  ['Coordinador de Comercio Exterior', 'Director de Abastecimiento y Comercio Exterior'],
  ['Analista de Comercio Exterior', 'Coordinador de Comercio Exterior'],
  ['Director de Planta', 'Gerente General'],
  ['Supervisor', 'Director de Planta'],
  ['Auxiliar de Producción', 'Supervisor'],
  ['Analista de Producción', 'Supervisor'],
  ['Auxiliar de Ingeniería', 'Director de Planta', true],
  ['Auxiliar de Soporte Tecnológico', 'Director de Planta', true],
  ['Auxiliar de Servicios Generales', 'Director de Planta', true],
  ['Auxiliar de Vigilancia', 'Director de Planta', true],
  ['Auxiliar de Recepción', 'Director de Planta', true],
  ['Director de Mercadeo', 'Gerente General'],
  ['Jefe de Línea', 'Director de Mercadeo'],
  ['Analista de Mercadeo', 'Director de Mercadeo', true],
  ['Auxiliar de Servicio al Cliente', 'Director de Mercadeo', true],
  ['Jefe de Ventas', 'Director de Mercadeo'],
  ['Representante de Ventas', 'Jefe de Ventas'],
  ['Especialista Senior Institucional', 'Jefe de Ventas'],
  ['Jefe de Nuevos Productos', 'Director de Mercadeo'],
  ['Director de Operaciones y Finanzas', 'Gerente General'],
  ['Jefe de Contabilidad', 'Director de Operaciones y Finanzas'],
  ['Coordinador de Contabilidad', 'Jefe de Contabilidad'],
  ['Analista Contable', 'Coordinador de Contabilidad'],
  ['Analista de Tesorería', 'Director de Operaciones y Finanzas', true],
  ['Jefe Jurídico', 'Director de Operaciones y Finanzas'],
  ['Director de Garantía de Calidad y Responsable Técnico de Laboratorio', 'Gerente General'],
  ['Coordinador de Validaciones', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio'],
  ['Analista de Validaciones', 'Coordinador de Validaciones'],
  ['Inspector de Calidad', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio', true],
  ['Auxiliar de Oficina - Garantía de Calidad', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio', true],
  ['Jefe de Control de Calidad', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio'],
  ['Analista de Calidad', 'Jefe de Control de Calidad'],
  ['Tecnólogo de Control de Calidad', 'Jefe de Control de Calidad'],
  ['Analista de Aseguramiento Metrológico', 'Jefe de Control de Calidad'],
  ['Jefe de Microbiología', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio'],
  ['Analista de Microbiología', 'Jefe de Microbiología'],
  ['Auxiliar de Microbiología', 'Jefe de Microbiología'],
  ['Oficial de Cumplimiento', 'Director de Garantía de Calidad y Responsable Técnico de Laboratorio', true],
  ['Director de Talento Humano', 'Gerente General'],
  ['Coordinador de Formación y Calificación de Personal', 'Director de Talento Humano'],
  ['Coordinador de Selección y Desarrollo', 'Director de Talento Humano'],
  ['Analista de Selección y Bienestar', 'Coordinador de Selección y Desarrollo'],
  ['Coordinador de Seguridad y Salud en el Trabajo (SST)', 'Director de Talento Humano'],
  ['Analista de SST', 'Coordinador de Seguridad y Salud en el Trabajo (SST)'],
  ['Auxiliar SST', 'Coordinador de Seguridad y Salud en el Trabajo (SST)'],
  ['Jefe de Talento Humano', 'Director de Talento Humano'],
  ['Analista de Nómina y Contratación', 'Jefe de Talento Humano'],
  // Áreas que el organigrama xlsx ubica colgando directo de Gerencia General
  ['Coordinador de Sistemas', 'Gerente General', true],
  ['Jefe de Mantenimiento', 'Gerente General', true],
  ['Supervisor de Mantenimiento', 'Jefe de Mantenimiento'],
  ['Técnico de Mantenimiento', 'Jefe de Mantenimiento'],
  ['Analista de Mantenimiento', 'Jefe de Mantenimiento'],
  ['Supervisor Logístico', 'Gerente General', true],
  ['Diseñador Gráfico', 'Gerente General', true],
  ['Planeador', 'Gerente General', true],
]

/**
 * Jerarquía Laboratorios Ryan (sección 4.2 — versión 22, feb-2026).
 * @type {Array<[string, string|null, boolean?]>}
 */
const JERARQUIA_RYAN = [
  ['Gerente General', null],
  // Apoyo directo a Gerencia
  ['Revisor Fiscal', 'Gerente General', true],
  ['Asistente General', 'Gerente General', true],
  ['Oficial de Cumplimiento', 'Gerente General', true],
  ['Profesional en Seguridad y Salud en el Trabajo', 'Gerente General', true],
  ['Jefe de Gestión Humana y SST', 'Gerente General', true],

  ['Director Administrativo', 'Gerente General'],
  ['Asistente de Gestión Humana', 'Director Administrativo'],
  ['Auxiliar de Recepción', 'Director Administrativo', true],
  ['Mensajero', 'Director Administrativo', true],
  ['Auxiliar de Aseo', 'Director Administrativo', true],
  ['Auxiliar de Servicios Generales', 'Director Administrativo', true],
  ['Jefe de Contabilidad', 'Director Administrativo'],
  ['Analista Contable', 'Jefe de Contabilidad'],
  ['Analista de Costos', 'Jefe de Contabilidad'],
  ['Auxiliar Contable', 'Jefe de Contabilidad'],

  ['Director Financiero', 'Gerente General'],

  ['Director Comercial', 'Gerente General'],
  ['Representante de Ventas', 'Director Comercial'],
  ['Auxiliar de Licitaciones', 'Director Comercial'],
  ['Auxiliar de Servicio al Cliente', 'Director Comercial', true],

  ['Director de Negocios Especiales', 'Gerente General'],

  ['Director de Producción', 'Gerente General'],
  ['Coordinador de Producción', 'Director de Producción'],
  ['Asistente de Producción', 'Coordinador de Producción'],
  ['Auxiliar de Producción', 'Coordinador de Producción'],
  ['Auxiliar de Fabricación', 'Coordinador de Producción'],
  ['Auxiliar de Autoclave y Fabricación', 'Coordinador de Producción'],

  ['Director Técnico', 'Gerente General'],
  ['Coordinador de Investigación y Desarrollo', 'Director Técnico'],
  ['Analista de Investigación y Desarrollo', 'Coordinador de Investigación y Desarrollo'],
  ['Supervisor de Estabilidades', 'Director Técnico'],
  ['Analista de Estabilidades', 'Supervisor de Estabilidades'],
  ['Coordinador de Asuntos Regulatorios', 'Director Técnico'],
  ['Analista de Asuntos Regulatorios y Farmacovigilancia', 'Coordinador de Asuntos Regulatorios'],
  ['Formulador Galénico', 'Director Técnico'],

  ['Director de Ingeniería', 'Gerente General'],
  ['Coordinador Bodega General', 'Director de Ingeniería'],
  ['Auxiliar de Almacén', 'Coordinador Bodega General'],
  ['Auxiliar de Compras', 'Coordinador Bodega General'],
  ['Jefe de Mantenimiento', 'Director de Ingeniería'],
  ['Técnico de Mantenimiento', 'Jefe de Mantenimiento'],
  ['Auxiliar de Mantenimiento', 'Jefe de Mantenimiento'],

  ['Director de Garantía de Calidad', 'Gerente General'],
  ['Coordinador de Garantía de Calidad y Gestión Ambiental', 'Director de Garantía de Calidad'],
  ['Analista de Aseguramiento Metrológico', 'Director de Garantía de Calidad', true],
  ['Inspector Garantía de Calidad', 'Director de Garantía de Calidad'],
  ['Asistente de Garantía de Calidad', 'Director de Garantía de Calidad'],
  ['Analista de Garantía de Calidad', 'Director de Garantía de Calidad'],
  ['Auxiliar de Diseño', 'Director de Garantía de Calidad', true],

  ['Director de Control de Calidad - Fisicoquímico', 'Gerente General'],
  ['Coordinador de Control de Calidad', 'Director de Control de Calidad - Fisicoquímico'],
  ['Analista de Control de Calidad', 'Director de Control de Calidad - Fisicoquímico'],
  ['Analista de Producto Terminado', 'Director de Control de Calidad - Fisicoquímico'],
  ['Analista de Material Envase y Empaque de Control de Calidad', 'Director de Control de Calidad - Fisicoquímico'],
  ['Auxiliar de Cadena de Custodia', 'Director de Control de Calidad - Fisicoquímico', true],
  ['Auxiliar de Documentación', 'Director de Control de Calidad - Fisicoquímico', true],
  ['Auxiliar de Control de Calidad', 'Director de Control de Calidad - Fisicoquímico', true],
  ['Auxiliar de Muestreo de Control de Calidad', 'Director de Control de Calidad - Fisicoquímico', true],

  ['Director de Microbiología', 'Gerente General'],
  ['Coordinador de Microbiología', 'Director de Microbiología'],
  ['Analista de Microbiología', 'Coordinador de Microbiología'],
  ['Auxiliar de Microbiología', 'Coordinador de Microbiología'],

  ['Director de Validaciones', 'Gerente General'],
  ['Coordinador de Validaciones', 'Director de Validaciones'],
  ['Analista de Validaciones', 'Coordinador de Validaciones'],
]

/** Cache nombre_normalizado -> id_cargo */
const cargoIdPorNombre = new Map()

async function sembrarCatalogo() {
  let count = 0
  for (const [display, nivel] of CATALOGO) {
    const nombre_normalizado = normalizar(display)
    const cargo = await prisma.cargo.upsert({
      where: { nombre_normalizado },
      update: { nivel },
      create: { nombre_normalizado, nivel },
    })
    cargoIdPorNombre.set(nombre_normalizado, cargo.id_cargo)
    count++
  }
  return count
}

/**
 * @param {number} idCompany
 * @param {Array<[string, string|null, boolean?]>} jerarquia
 * @param {string} etiqueta
 */
async function sembrarJerarquia(idCompany, jerarquia, etiqueta) {
  let count = 0
  const faltantes = new Set()
  for (const [hijo, padre, aproximada = false] of jerarquia) {
    const idHijo = cargoIdPorNombre.get(normalizar(hijo))
    if (!idHijo) {
      faltantes.add(hijo)
      continue
    }
    let idPadre = null
    if (padre !== null) {
      idPadre = cargoIdPorNombre.get(normalizar(padre)) ?? null
      if (idPadre === null) {
        faltantes.add(`${padre} (padre de ${hijo})`)
        continue
      }
    }
    // Idempotente vía @@unique([id_company, id_cargo])
    const existente = await prisma.cargoJerarquia.findUnique({
      where: { id_company_id_cargo: { id_company: idCompany, id_cargo: idHijo } },
    })
    if (existente) {
      await prisma.cargoJerarquia.update({
        where: { id_cargo_jerarquia: existente.id_cargo_jerarquia },
        data: { id_cargo_padre: idPadre, aproximada },
      })
    } else {
      await prisma.cargoJerarquia.create({
        data: { id_company: idCompany, id_cargo: idHijo, id_cargo_padre: idPadre, aproximada },
      })
    }
    count++
  }
  if (faltantes.size > 0) {
    console.warn(`  [${etiqueta}] cargos no encontrados en catálogo (revisar): ${[...faltantes].join('; ')}`)
  }
  return count
}

/** @param {string} like */
async function resolverEmpresa(like) {
  return prisma.company.findFirst({ where: { company: { contains: like } } })
}

async function main() {
  console.log('=== Seed Organigrama (SynerLink) ===')
  const cargos = await sembrarCatalogo()
  console.log(`Cargos en catálogo (upsert): ${cargos}`)

  const empresasNoEncontradas = []

  let relFL = 0
  const farma = await resolverEmpresa('Farma')
  if (farma) {
    relFL = await sembrarJerarquia(farma.id_company, JERARQUIA_FARMALOGICA, 'Farmalógica')
    console.log(`Jerarquía Farmalógica (id_company=${farma.id_company}): ${relFL} relaciones`)
  } else {
    empresasNoEncontradas.push('Farmalógica (contains "Farma")')
  }

  let relRyan = 0
  const ryan = await resolverEmpresa('Ryan')
  if (ryan) {
    relRyan = await sembrarJerarquia(ryan.id_company, JERARQUIA_RYAN, 'Ryan')
    console.log(`Jerarquía Ryan (id_company=${ryan.id_company}): ${relRyan} relaciones`)
  } else {
    empresasNoEncontradas.push('Ryan (contains "Ryan")')
  }

  console.log('--- Resumen ---')
  console.log(`Cargos: ${cargos} | Relaciones FL: ${relFL} | Relaciones Ryan: ${relRyan}`)
  if (empresasNoEncontradas.length > 0) {
    console.log(`Empresas NO encontradas (se saltaron): ${empresasNoEncontradas.join(', ')}`)
  } else {
    console.log('Todas las empresas objetivo fueron resueltas.')
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('Error en el seed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
