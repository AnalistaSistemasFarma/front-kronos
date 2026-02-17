# ACTA DE ENTREGA - MÓDULO MESA DE AYUDA (HELP DESK)

**PROYECTO:** Front-Kronos - Portal de Servicios Compartidos  
**MÓDULO:** Mesa de Ayuda / Help Desk  
**FECHA:** 5 de Febrero de 2026  
**VERSIÓN:** 0.1.0

---

## 1. INFORMACIÓN GENERAL

### 1.1 Descripción del Módulo

El **Módulo de Mesa de Ayuda (Help Desk)** es un sistema completo de gestión de tickets de soporte técnico que permite a los usuarios crear, seguimiento y gestionar solicitudes de soporte de manera eficiente. El módulo proporciona herramientas para la asignación de técnicos, priorización de casos, seguimiento de estados y generación de reportes estadísticos.

### 1.2 Objetivos del Módulo

- Centralizar la gestión de solicitudes de soporte técnico
- Automatizar la asignación de técnicos a casos
- Proporcionar visibilidad en tiempo real del estado de los tickets
- Facilitar la comunicación entre solicitantes y técnicos
- Generar reportes estadísticos para toma de decisiones

### 1.3 Stack Tecnológico Específico

- **Framework:** Next.js 15.5.4 con App Router
- **Lenguaje:** TypeScript 5
- **UI Library:** Mantine Core 8.3.3
- **Base de Datos:** SQL Server con Prisma ORM 6.17.0
- **Notificaciones:** React Hot Toast 2.6.0
- **Gráficos:** Mantine Charts 8.3.6

---

## 2. FUNCIONALIDADES DEL MÓDULO

### 2.1 Gestión de Tickets de Soporte

#### 2.1.1 Panel Principal de Tickets

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:1)
- **Funcionalidades:**
  - Visualización de todos los tickets del sistema
  - Filtros avanzados de búsqueda
  - Paginación de resultados
  - Vista en tabla con información detallada
  - Acceso rápido a detalles de cada ticket
  - Actualización en tiempo real

#### 2.1.2 Dashboard de Estadísticas

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:551)
- **Indicadores en Tiempo Real:**
  - **Total de Casos:** Conteo total de tickets en el sistema
  - **Casos Resueltos:** Tickets con estado "Resuelto" o "Cerrado"
  - **En Progreso:** Tickets con estado "Abierto"
  - **Alta Prioridad:** Tickets marcados como prioridad "Alta"
- **Gráficos de Reportes:**
  - Componente [`ReportsChart`](components/help-desk/ReportsChart.tsx:1)
  - Visualización de métricas por período
  - Gráficos de tendencias
  - Distribución por categoría y estado

#### 2.1.3 Filtros de Búsqueda Avanzados

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:636)
- **Filtros Disponibles:**
  - **Prioridad:** Baja, Media, Alta
  - **Estado:** Todos, Abierto, Resuelto, Cancelado
  - **Empresa:** Todas las empresas del sistema
  - **Técnico Asignado:** Todos los técnicos disponibles
  - **Fecha Desde:** Rango inferior de fechas
  - **Fecha Hasta:** Rango superior de fechas
- **Características:**
  - Filtros expandibles/colapsables
  - Validación de rangos de fechas
  - Botón de limpiar filtros
  - Aplicación de filtros en tiempo real

---

### 2.2 Creación de Tickets

#### 2.2.1 Formulario de Creación de Tickets

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:854)
- **Modal Interactivo:**
  - Diseño responsivo
  - Validación de campos en tiempo real
  - Indicadores de carga
  - Mensajes de error claros

#### 2.2.2 Campos del Formulario

##### Información Básica

- **Tipo de Solicitud** (Obligatorio)

  - Opciones: Incidente, Solicitud
  - Clasificación inicial del ticket

- **Prioridad** (Obligatorio)

  - Opciones: Baja, Media, Alta
  - Determina urgencia de atención
  - Sistema de colores (verde, amarillo, rojo)

- **Empresa Solicitante** (Obligatorio)

  - Lista de empresas del sistema
  - Cargada dinámicamente desde API
  - Filtrada por permisos del usuario

- **Sitio** (Obligatorio)
  - Opciones: Administrativa, Planta, Celta
  - Ubicación física donde se presenta el incidente

##### Detalles del Ticket

- **Asunto** (Obligatorio)

  - Máximo 100 caracteres
  - Título descriptivo del problema
  - Validación de campo requerido

- **Categoría** (Obligatorio)

  - Lista de categorías principales
  - Cargada desde API dinámicamente
  - Dispara carga de subcategorías

- **Subcategoría** (Obligatorio)

  - Dependiente de la categoría seleccionada
  - Cargada dinámicamente al seleccionar categoría
  - Dispara carga de actividades

- **Actividad** (Obligatorio)

  - Dependiente de la subcategoría seleccionada
  - Cargada dinámicamente al seleccionar subcategoría
  - Clasificación específica del problema

- **Departamento** (Obligatorio)

  - Lista de departamentos del sistema
  - Área funcional afectada

- **Técnico Asignado** (Opcional)

  - Lista de técnicos disponibles
  - Cargada desde API de subprocess users
  - Puede dejarse sin asignar
  - Sistema de reintentos si falla la carga

- **Descripción Detallada** (Obligatorio)
  - Mínimo 10 caracteres
  - Máximo 1000 caracteres
  - Área de texto multilineal
  - Permite describir el problema en detalle

#### 2.2.3 Validación del Formulario

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:473)
- **Validaciones Implementadas:**
  - Todos los campos obligatorios marcados
  - Validación de longitud mínima y máxima
  - Mensajes de error específicos por campo
  - Prevención de envío con datos inválidos
  - Limpieza de errores al corregir campos

---

### 2.3 Visualización de Tickets

#### 2.3.1 Lista de Tickets

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:756)
- **Columnas de la Tabla:**
  - **ID:** Identificador único del ticket (Badge azul)
  - **Asunto:** Título del ticket con truncamiento
  - **Empresa:** Empresa asociada al ticket
  - **Prioridad:** Badge con color según nivel (rojo/amarillo/verde)
  - **Estado:** Badge con color según estado
  - **Fecha de Creación:** Formato ISO localizado
  - **Técnico Asignado:** Nombre del técnico o "Sin asignar"

#### 2.3.2 Interactividad

- **Click en Fila:**
  - Navegación a vista detallada del ticket
  - Almacenamiento en sessionStorage del ticket seleccionado
  - Almacenamiento de la lista completa para navegación
  - URL: `/process/help-desk/view-ticket?id={id_case}`

#### 2.3.3 Estados Vacíos

- **Mensaje cuando no hay tickets:**
  - Icono de ticket grande
  - Texto descriptivo
  - Sugerencia de ajustar filtros o crear nuevo ticket

---

### 2.4 Gestión de Categorías y Subcategorías

#### 2.4.1 Sistema Jerárquico

- **Categoría** → **Subcategoría** → **Actividad**
- Cada nivel depende del anterior
- Carga dinámica (lazy loading)
- Filtrado por permisos de usuario

#### 2.4.2 API de Categorías

- **Endpoint:** [`GET /api/help-desk/categories`](app/api/help-desk/categories/route.js:1)
- **Funcionalidad:**
  - Retorna todas las categorías activas
  - Formato: `{ id_category, category }`
  - Usado en formulario de creación

#### 2.4.3 API de Subcategorías

- **Endpoint:** [`GET /api/help-desk/subcategories?category_id={id}`](app/api/help-desk/subcategories/route.js:1)
- **Funcionalidad:**
  - Retorna subcategorías filtradas por categoría
  - Formato: `{ id_subcategory, subcategory }`
  - Cargado dinámicamente al seleccionar categoría

#### 2.4.4 API de Actividades

- **Endpoint:** [`GET /api/help-desk/activities?subcategory_id={id}`](app/api/help-desk/activities/route.js:1)
- **Funcionalidad:**
  - Retorna actividades filtradas por subcategoría
  - Formato: `{ id_activity, activity }`
  - Cargado dinámicamente al seleccionar subcategoría

---

### 2.5 Gestión de Técnicos

#### 2.5.1 API de Técnicos

- **Endpoint:** [`GET /api/help-desk/technical`](app/api/help-desk/technical/route.js:1)
- **Funcionalidad:**
  - Retorna lista de técnicos disponibles
  - Formato: `{ id_subprocess_user_company, subprocess, id_company_user, name }`
  - Filtrado por subprocesos asignados al usuario
  - Sistema de reintentos en caso de error

#### 2.5.2 Manejo de Errores

- **Mensaje de error específico:** "No se pudieron cargar los técnicos. Intente nuevamente."
- **Botón de reintentar:** Permite recargar la lista de técnicos
- **Estado de carga:** Spinner animado durante la carga
- **Estado vacío:** Mensaje cuando no hay técnicos disponibles

---

### 2.6 Gestión de Departamentos

#### 2.6.1 API de Departamentos

- **Endpoint:** [`GET /api/help-desk/departments`](app/api/help-desk/departments/route.js:1)
- **Funcionalidad:**
  - Retorna todos los departamentos activos
  - Formato: `{ id_department, department }`
  - Usado en formulario de creación

---

### 2.7 Creación de Tickets (Backend)

#### 2.7.1 API de Creación de Tickets

- **Endpoint:** [`POST /api/help-desk/create_ticket`](app/api/help-desk/create_ticket/route.js:1)
- **Payload:**
  ```javascript
  {
    requestType: "Incidente" | "Solicitud",
    priority: "Baja" | "Media" | "Alta",
    technician: string, // ID del técnico (opcional)
    category: string, // ID de categoría
    site: "Administrativa" | "Planta" | "Celta",
    requester: string, // ID del usuario solicitante
    asunto: string,
    subcategory: string, // ID de subcategoría
    department: string, // ID de departamento
    activity: string, // ID de actividad
    description: string,
    company: string // ID de empresa
  }
  ```

#### 2.7.2 Proceso de Creación

1. Validación de campos obligatorios
2. Verificación de existencia de categoría, subcategoría, actividad, departamento
3. Verificación de técnico (si se proporciona)
4. Creación del registro en base de datos
5. Generación de ID de caso
6. Asignación de fecha de creación
7. Retorno del ticket creado
8. Actualización de la lista en frontend

---

### 2.8 Listado de Tickets (Backend)

#### 2.8.1 API de Listado de Tickets

- **Endpoint:** [`GET /api/help-desk/tickets`](app/api/help-desk/tickets/route.js:1)
- **Query Parameters:**
  - `subprocess_id`: Filtrar por subproceso (opcional)
  - `priority`: Filtrar por prioridad (opcional)
  - `status`: Filtrar por estado (opcional)
  - `assigned_user`: Filtrar por técnico asignado (opcional)
  - `date_from`: Fecha desde (opcional)
  - `date_to`: Fecha hasta (opcional)
  - `technician`: Filtrar por técnico (opcional)
  - `company`: Filtrar por empresa (opcional)

#### 2.8.2 Response

```javascript
[
  {
    id_case: number,
    subject_case: string,
    priority: string,
    status: string,
    creation_date: string,
    nombreTecnico: string,
    subprocess_id: number,
    company: string,
  },
];
```

---

### 2.9 Actualización de Tickets

#### 2.9.1 API de Actualización

- **Endpoint:** [`POST /api/help-desk/update_ticket`](app/api/help-desk/update_ticket/route.js:1)
- **Funcionalidad:**
  - Actualización de estado del ticket
  - Reasignación de técnico
  - Actualización de resolución
  - Registro de cambios en logs

---

### 2.10 Gestión de Notas

#### 2.10.1 API de Notas

- **Endpoint:** [`POST /api/help-desk/notes`](app/api/help-desk/notes/route.js:1)
- **Funcionalidad:**
  - Agregar notas a tickets existentes
  - Seguimiento de comunicaciones
  - Registro de histórico de cambios

---

### 2.11 Dashboard de Casos

#### 2.11.1 API de Dashboard

- **Endpoint:** [`GET /api/help-desk/view_cases_dashboard`](app/api/help-desk/view_cases_dashboard/route.js:1)
- **Funcionalidad:**
  - Estadísticas generales de casos
  - Distribución por estado
  - Distribución por prioridad
  - Tendencias temporales

---

### 2.12 Control de Acceso

#### 2.12.1 Hook de Acceso

- **Ubicación:** [`components/help-desk/hooks/useHelpDeskAccess.ts`](components/help-desk/hooks/useHelpDeskAccess.ts:1)
- **Funcionalidad:**
  - Verificación de permisos de usuario
  - Control de acceso al módulo
  - Redirección si no tiene permisos
  - Protección de componentes sensibles

---

### 2.13 Componentes Especializados

#### 2.13.1 ReportsChart

- **Ubicación:** [`components/help-desk/ReportsChart.tsx`](components/help-desk/ReportsChart.tsx:1)
- **Funcionalidades:**
  - Gráficos de barras
  - Gráficos de líneas
  - Visualización de tendencias
  - Comparación de períodos
  - Responsive design
  - Animaciones suaves

---

## 3. BASE DE DATOS - MÓDULO HELP DESK

### 3.1 Tablas Principales

#### 3.1.1 Tabla: Case

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:185)
- **Campos:**
  - `id_case`: Identificador único (PK)
  - `description`: Descripción del caso (Text)
  - `id_status_case`: Estado del caso (FK)
  - `subject_case`: Asunto del caso
  - `creation_date`: Fecha de creación
  - `resolution`: Resolución del caso (Text, nullable)
  - `end_date`: Fecha de cierre (nullable)
  - `id_technical`: Técnico asignado (FK)
  - `requester`: Solicitante
  - `id_active`: Tipo de activo (FK, nullable)
  - `place`: Ubicación (nullable)
  - `id_department`: Departamento (FK)
  - `case_type`: Tipo de caso
  - `priority`: Prioridad

#### 3.1.2 Tabla: StatusCase

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:131)
- **Campos:**
  - `id_status_case`: Identificador único (PK)
  - `status`: Estado (unique)

#### 3.1.3 Tabla: Active

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:139)
- **Campos:**
  - `id_active`: Identificador único (PK)
  - `name`: Nombre del activo (unique)

#### 3.1.4 Tabla: Department

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:147)
- **Campos:**
  - `id_department`: Identificador único (PK)
  - `department`: Nombre del departamento (unique)

#### 3.1.5 Tabla: Category

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:155)
- **Campos:**
  - `id_category`: Identificador único (PK)
  - `category`: Nombre de categoría (unique)

#### 3.1.6 Tabla: Subcategory

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:164)
- **Campos:**
  - `id_subcategory`: Identificador único (PK)
  - `subcategory`: Nombre de subcategoría (unique)
  - `id_category`: Categoría padre (FK)

#### 3.1.7 Tabla: Activity

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:175)
- **Campos:**
  - `id_activity`: Identificador único (PK)
  - `activity`: Nombre de actividad
  - `id_subcategory`: Subcategoría padre (FK)

#### 3.1.8 Tabla: CategoryCase

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:211)
- **Campos:**
  - `id_category_case`: Identificador único (PK)
  - `id_case`: Caso asociado (FK)
  - `id_category`: Categoría (FK)
  - `id_subcategory`: Subcategoría (FK)
  - `id_activity`: Actividad (FK)

#### 3.1.9 Tabla: Note

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:225)
- **Campos:**
  - `id_note`: Identificador único (PK)
  - `id_case`: Caso asociado (FK)
  - `note`: Contenido de la nota (Text)

#### 3.1.10 Tabla: LogCaseHelpDesk

- **Ubicación en Schema:** [`prisma/schema.prisma`](prisma/schema.prisma:234)
- **Campos:**
  - `id_log`: Identificador único (PK)
  - `id_case`: Caso asociado (FK)
  - `log`: Contenido del log (Text)

---

## 4. FLUJOS DE USUARIO

### 4.1 Flujo de Creación de Ticket

```
1. Usuario accede a /process/help-desk/create-ticket
   ↓
2. Sistema carga lista de tickets existentes
   ↓
3. Usuario hace clic en "Crear Nuevo Caso"
   ↓
4. Modal de creación se abre
   ↓
5. Sistema carga opciones dinámicamente:
   - Empresas
   - Categorías
   - Departamentos
   - Técnicos
   ↓
6. Usuario selecciona Categoría
   ↓
7. Sistema carga Subcategorías
   ↓
8. Usuario selecciona Subcategoría
   ↓
9. Sistema carga Actividades
   ↓
10. Usuario completa todos los campos obligatorios
   ↓
11. Sistema valida el formulario
   ↓
12. Usuario hace clic en "Crear Caso"
   ↓
13. Sistema envía POST a /api/help-desk/create_ticket
   ↓
14. Backend crea el ticket en base de datos
   ↓
15. Frontend actualiza la lista de tickets
   ↓
16. Modal se cierra
   ↓
17. Toast de éxito se muestra
```

### 4.2 Flujo de Búsqueda y Filtrado

```
1. Usuario accede a /process/help-desk/create-ticket
   ↓
2. Sistema carga todos los tickets del usuario
   ↓
3. Usuario hace clic en icono de filtros
   ↓
4. Panel de filtros se expande
   ↓
5. Usuario selecciona uno o más filtros:
   - Prioridad
   - Estado
   - Empresa
   - Técnico
   - Rango de fechas
   ↓
6. Sistema valida los filtros
   ↓
7. Usuario hace clic en "Aplicar Filtros"
   ↓
8. Sistema envía GET a /api/help-desk/tickets con parámetros
   ↓
9. Backend filtra los tickets según criterios
   ↓
10. Frontend actualiza la lista con resultados filtrados
```

### 4.3 Flujo de Visualización de Ticket

```
1. Usuario hace clic en una fila de la tabla de tickets
   ↓
2. Sistema guarda ticket seleccionado en sessionStorage
   ↓
3. Sistema guarda lista completa en sessionStorage
   ↓
4. Sistema navega a /process/help-desk/view-ticket?id={id_case}
   ↓
5. Vista detallada del ticket se carga
```

---

## 5. CARACTERÍSTICAS TÉCNICAS

### 5.1 Seguridad

- **Control de Acceso:** Verificación de permisos por usuario
- **Validación de Datos:** Validación en frontend y backend
- **Protección de Rutas:** Middleware de autenticación
- **Sanitización de Inputs:** Prevención de inyección SQL
- **Auditoría:** Logs de todas las acciones

### 5.2 Performance

- **Lazy Loading:** Carga dinámica de subcategorías y actividades
- **Paginación:** Manejo eficiente de grandes volúmenes de datos
- **Caching:** Almacenamiento en sessionStorage
- **Skeletons:** Estados de carga optimizados
- **Optimización de Consultas:** Índices en base de datos

### 5.3 UX/UI

- **Diseño Responsive:** Mobile-first approach
- **Feedback Visual:** Toasts de notificación
- **Estados de Carga:** Indicadores claros
- **Mensajes de Error:** Claros y accionables
- **Animaciones Suaves:** Transiciones fluidas
- **Accesibilidad:** Labels ARIA, navegación por teclado
- **Colores Semánticos:** Uso de colores para indicar prioridad/estado

### 5.4 Validaciones

- **Frontend:** Validación en tiempo real
- **Backend:** Validación de datos recibidos
- **Longitud de Campos:** Mínimos y máximos definidos
- **Campos Obligatorios:** Marcados claramente
- **Tipos de Datos:** Validación de tipos

---

## 6. API ENDPOINTS - MÓDULO HELP DESK

### 6.1 Endpoints Disponibles

| Método | Endpoint                              | Descripción                          |
| ------ | ------------------------------------- | ------------------------------------ |
| GET    | `/api/help-desk/tickets`              | Listar tickets con filtros           |
| POST   | `/api/help-desk/create_ticket`        | Crear nuevo ticket                   |
| GET    | `/api/help-desk/categories`           | Obtener categorías                   |
| GET    | `/api/help-desk/subcategories`        | Obtener subcategorías por categoría  |
| GET    | `/api/help-desk/activities`           | Obtener actividades por subcategoría |
| GET    | `/api/help-desk/departments`          | Obtener departamentos                |
| GET    | `/api/help-desk/technical`            | Obtener técnicos disponibles         |
| POST   | `/api/help-desk/notes`                | Agregar nota a ticket                |
| POST   | `/api/help-desk/update_ticket`        | Actualizar ticket                    |
| GET    | `/api/help-desk/view_cases_dashboard` | Obtener estadísticas del dashboard   |

### 6.2 Detalle de Endpoints

#### GET /api/help-desk/tickets

- **Query Params:**
  - `subprocess_id` (opcional): ID del subproceso
  - `priority` (opcional): Prioridad (Baja/Media/Alta)
  - `status` (opcional): Estado (1=Abierto, 2=Resuelto, 3=Cancelado)
  - `assigned_user` (opcional): ID de usuario asignado
  - `date_from` (opcional): Fecha desde (YYYY-MM-DD)
  - `date_to` (opcional): Fecha hasta (YYYY-MM-DD)
  - `technician` (opcional): ID de técnico
  - `company` (opcional): ID de empresa
- **Response:** Array de tickets

#### POST /api/help-desk/create_ticket

- **Body:** JSON con datos del ticket
- **Response:** Ticket creado con ID

#### GET /api/help-desk/categories

- **Response:** Array de categorías `{ id_category, category }`

#### GET /api/help-desk/subcategories

- **Query Params:**
  - `category_id` (requerido): ID de categoría
- **Response:** Array de subcategorías `{ id_subcategory, subcategory }`

#### GET /api/help-desk/activities

- **Query Params:**
  - `subcategory_id` (requerido): ID de subcategoría
- **Response:** Array de actividades `{ id_activity, activity }`

#### GET /api/help-desk/departments

- **Response:** Array de departamentos `{ id_department, department }`

#### GET /api/help-desk/technical

- **Response:** Array de técnicos `{ id_subprocess_user_company, subprocess, id_company_user, name }`

#### POST /api/help-desk/notes

- **Body:** JSON con nota y ID de caso
- **Response:** Nota creada

#### POST /api/help-desk/update_ticket

- **Body:** JSON con datos a actualizar
- **Response:** Ticket actualizado

#### GET /api/help-desk/view_cases_dashboard

- **Response:** Estadísticas del dashboard

---

## 7. COMPONENTES DEL MÓDULO

### 7.1 Componentes Principales

#### 7.1.1 TicketsBoard

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:72)
- **Responsabilidades:**
  - Gestión de estado de tickets
  - Manejo de filtros
  - Creación de tickets
  - Navegación a detalles

#### 7.1.2 ReportsChart

- **Ubicación:** [`components/help-desk/ReportsChart.tsx`](components/help-desk/ReportsChart.tsx:1)
- **Responsabilidades:**
  - Visualización de gráficos
  - Generación de estadísticas
  - Responsive design

#### 7.1.3 useHelpDeskAccess

- **Ubicación:** [`components/help-desk/hooks/useHelpDeskAccess.ts`](components/help-desk/hooks/useHelpDeskAccess.ts:1)
- **Responsabilidades:**
  - Verificación de permisos
  - Control de acceso
  - Redirección de usuarios no autorizados

---

## 8. ESTADOS Y PRIORIDADES

### 8.1 Estados de Tickets

- **Abierto (1):** Ticket creado y pendiente de atención
- **Resuelto (2):** Ticket completado exitosamente
- **Cancelado (3):** Ticket cancelado por solicitante o sistema

### 8.2 Prioridades de Tickets

- **Baja:** Problema menor, no afecta operaciones
- **Media:** Problema moderado, afecta parcialmente operaciones
- **Alta:** Problema crítico, afecta significativamente operaciones

### 8.3 Colores de Prioridad

- **Baja:** Verde (`#10b981`)
- **Media:** Amarillo (`#f59e0b`)
- **Alta:** Rojo (`#ef4444`)

### 8.4 Colores de Estado

- **Abierto:** Verde (`#10b981`)
- **Resuelto:** Azul (`#3b82f6`)
- **Cancelado:** Gris (`#6b7280`)

---

## 9. REQUISITOS DEL SISTEMA

### 9.1 Requisitos Funcionales

- ✅ Creación de tickets de soporte
- ✅ Asignación de técnicos
- ✅ Priorización de casos
- ✅ Seguimiento de estados
- ✅ Filtros de búsqueda avanzados
- ✅ Dashboard con estadísticas
- ✅ Gestión de categorías jerárquicas
- ✅ Gestión de notas
- ✅ Actualización de tickets
- ✅ Control de acceso por usuario

### 9.2 Requisitos No Funcionales

- **Performance:** Carga de lista < 2 segundos
- **Disponibilidad:** 99.5% uptime
- **Escalabilidad:** Soporte para 10,000+ tickets
- **Seguridad:** Autenticación requerida
- **Usabilidad:** Interface intuitiva
- **Responsive:** Compatible con dispositivos móviles

---

## 10. PRUEBAS Y VALIDACIÓN

### 10.1 Casos de Prueba

#### 10.1.1 Creación de Tickets

- ✅ Crear ticket con todos los campos obligatorios
- ✅ Crear ticket sin técnico asignado
- ✅ Validar campos obligatorios
- ✅ Validar longitud mínima de descripción
- ✅ Validar longitud máxima de asunto
- ✅ Crear ticket con cada prioridad
- ✅ Crear ticket con cada tipo de solicitud

#### 10.1.2 Filtros de Búsqueda

- ✅ Filtrar por prioridad Alta
- ✅ Filtrar por estado Abierto
- ✅ Filtrar por empresa específica
- ✅ Filtrar por técnico asignado
- ✅ Filtrar por rango de fechas
- ✅ Combinar múltiples filtros
- ✅ Limpiar filtros

#### 10.1.3 Categorías y Subcategorías

- ✅ Cargar categorías correctamente
- ✅ Cargar subcategorías al seleccionar categoría
- ✅ Cargar actividades al seleccionar subcategoría
- ✅ Limpiar subcategorías al cambiar categoría
- ✅ Limpiar actividades al cambiar subcategoría

#### 10.1.4 Dashboard

- ✅ Mostrar estadísticas correctas
- ✅ Actualizar en tiempo real
- ✅ Renderizar gráficos correctamente
- ✅ Responsive design

### 10.2 Navegadores Probados

- ✅ Chrome 120+
- ✅ Firefox 120+
- ✅ Safari 17+
- ✅ Edge 120+

### 10.3 Dispositivos Probados

- ✅ Desktop (1920x1080)
- ✅ Laptop (1366x768)
- ✅ Tablet (768x1024)
- ✅ Mobile (375x667)

---

## 11. MANTENIMIENTO Y SOPORTE

### 11.1 Monitoreo

- Logs de errores en consola
- Auditoría de acciones de usuarios
- Métricas de performance
- Alertas de errores críticos

### 11.2 Backups

- Backups diarios de base de datos
- Retención de 30 días
- Backups automatizados
- Procedimiento de restauración documentado

### 11.3 Actualizaciones

- Actualización de dependencias mensual
- Parches de seguridad inmediatos
- Testing en staging antes de producción
- Rollback planificado

---

## 12. DOCUMENTACIÓN

### 12.1 Documentación de Código

- TypeScript con tipos definidos
- Comentarios en funciones complejas
- JSDoc en APIs públicas
- Nombres descriptivos de variables

### 12.2 Documentación de Usuario

- Guía de uso del módulo
- Capturas de pantalla
- Videos tutoriales (opcional)
- FAQ

---

## 13. ENTREGABLES

### 13.1 Código Fuente

- ✅ Componente TicketsBoard completo
- ✅ API endpoints implementados
- ✅ Componente ReportsChart
- ✅ Hook useHelpDeskAccess
- ✅ Esquema de base de datos

### 13.2 Documentación

- ✅ Acta de entrega (este documento)
- ✅ Comentarios en código
- ✅ Tipos TypeScript definidos

### 13.3 Pruebas

- ✅ Casos de prueba documentados
- ✅ Validación de funcionalidades
- ✅ Pruebas de navegadores y dispositivos

---

## 14. RECOMENDACIONES

### 14.1 Mejoras Futuras

1. **Notificaciones Push:** Alertas en tiempo real para nuevos tickets
2. **Chat en Vivo:** Comunicación directa entre solicitante y técnico
3. **SLA Management:** Seguimiento de tiempos de respuesta
4. **Knowledge Base:** Base de conocimiento de soluciones comunes
5. **Automatización:** Asignación automática basada en carga de técnicos
6. **Encuestas de Satisfacción:** Feedback post-resolución
7. **Integración con Email:** Creación de tickets por email
8. **Reportes Avanzados:** Exportación a PDF, Excel
9. **Mobile App:** Aplicación nativa para móviles
10. **AI/ML:** Sugerencias de soluciones basadas en tickets similares

### 14.2 Optimizaciones

1. Implementar cache Redis para consultas frecuentes
2. Optimizar queries de base de datos con índices adicionales
3. Implementar lazy loading para listas grandes
4. Comprimir respuestas API
5. Implementar CDN para assets estáticos

### 14.3 Seguridad Adicional

1. Implementar rate limiting en API endpoints
2. Agregar CAPTCHA en creación de tickets
3. Implementar 2FA para técnicos
4. Encriptar datos sensibles en base de datos
5. Implementar auditoría detallada con blockchain (opcional)

---

## 15. FIRMAS DE ACEPTACIÓN

### 15.1 Entregado por

**Nombre:** ************\_\_************  
**Cargo:** ************\_\_************  
**Fecha:** ************\_\_************  
**Firma:** ************\_\_************

### 15.2 Recibido por

**Nombre:** ************\_\_************  
**Cargo:** ************\_\_************  
**Fecha:** ************\_\_************  
**Firma:** ************\_\_************

---

## 16. ANEXOS

### 16.1 Diccionario de Datos

#### Tabla: Case

| Campo          | Tipo     | Descripción                    | Obligatorio |
| -------------- | -------- | ------------------------------ | ----------- |
| id_case        | Int      | Identificador único del caso   | Sí          |
| description    | Text     | Descripción detallada del caso | Sí          |
| id_status_case | Int      | Estado del caso (FK)           | Sí          |
| subject_case   | String   | Asunto del caso                | Sí          |
| creation_date  | DateTime | Fecha de creación              | Sí          |
| resolution     | Text     | Resolución del caso            | No          |
| end_date       | DateTime | Fecha de cierre                | No          |
| id_technical   | String   | Técnico asignado (FK)          | Sí          |
| requester      | String   | Solicitante del caso           | Sí          |
| id_active      | Int      | Tipo de activo (FK)            | No          |
| place          | String   | Ubicación física               | No          |
| id_department  | Int      | Departamento (FK)              | Sí          |
| case_type      | String   | Tipo de caso                   | Sí          |
| priority       | String   | Prioridad (Baja/Media/Alta)    | Sí          |

### 16.2 Códigos de Estado HTTP

- `200 OK`: Solicitud exitosa
- `201 Created`: Recurso creado exitosamente
- `400 Bad Request`: Datos inválidos
- `401 Unauthorized`: No autenticado
- `403 Forbidden`: Sin permisos
- `404 Not Found`: Recurso no encontrado
- `500 Internal Server Error`: Error del servidor

### 16.3 Códigos de Error Personalizados

- `HD001`: Categoría no encontrada
- `HD002`: Subcategoría no encontrada
- `HD003`: Actividad no encontrada
- `HD004`: Departamento no encontrado
- `HD005`: Técnico no encontrado
- `HD006`: Campos obligatorios faltantes
- `HD007`: Descripción demasiado corta
- `HD008`: Asunto demasiado largo

---

## 17. GLOSARIO

- **Ticket:** Registro de una solicitud de soporte técnico
- **Caso:** Sinónimo de ticket
- **Técnico:** Usuario asignado para resolver tickets
- **Solicitante:** Usuario que crea el ticket
- **Prioridad:** Nivel de urgencia del ticket (Baja/Media/Alta)
- **Estado:** Situación actual del ticket (Abierto/Resuelto/Cancelado)
- **Categoría:** Clasificación principal del problema
- **Subcategoría:** Clasificación secundaria del problema
- **Actividad:** Clasificación específica del problema
- **Dashboard:** Panel de visualización de métricas
- **SLA:** Service Level Agreement (Acuerdo de Nivel de Servicio)

---

**ESTE DOCUMENTO CONSTITUYE EL ACTA OFICIAL DE ENTREGA DEL MÓDULO MESA DE AYUDA (HELP DESK) DEL PROYECTO FRONT-KRONOS VERSIÓN 0.1.0**
