# ACTA DE ENTREGA DE SOFTWARE

**PROYECTO:** Front-Kronos - Portal de Servicios Compartidos  
**FECHA:** 5 de Febrero de 2026  
**VERSIÓN:** 0.1.0

---

## 1. INFORMACIÓN GENERAL

### 1.1 Descripción del Proyecto

El **Front-Kronos** es un portal web de servicios compartidos desarrollado con Next.js 15.5.4, diseñado para centralizar y optimizar las operaciones empresariales de múltiples áreas incluyendo Recursos Humanos, Finanzas, TI y Compras.

### 1.2 Stack Tecnológico

- **Framework:** Next.js 15.5.4 con App Router
- **Lenguaje:** TypeScript 5
- **UI Library:** Mantine Core 8.3.3
- **Autenticación:** NextAuth 4.24.11
- **Base de Datos:** SQL Server con Prisma ORM 6.17.0
- **Estilos:** Tailwind CSS 4
- **Estado:** React Hooks y Context API
- **Integraciones:** Microsoft Graph API, SAP Business One

---

## 2. MÓDULOS Y FUNCIONALIDADES

### 2.1 Módulo de Autenticación y Seguridad

#### 2.1.1 Inicio de Sesión

- **Ubicación:** [`app/login/page.tsx`](app/login/page.tsx:1)
- **Funcionalidades:**
  - Autenticación mediante credenciales (email/contraseña)
  - Integración con Azure AD (Microsoft 365)
  - Interfaz con diseño moderno y animado
  - Validación de credenciales en tiempo real
  - Mostrar/ocultar contraseña
  - Recuperación de contraseña
  - Redirección automática al dashboard tras login exitoso

#### 2.1.2 Registro de Usuarios

- **Ubicación:** [`app/register/page.tsx`](app/register/page.tsx:1)
- **Funcionalidades:**
  - Formulario de registro de nuevos usuarios
  - Validación de email único
  - Encriptación de contraseñas con bcryptjs
  - Verificación de email

#### 2.1.3 Gestión de Sesiones

- **Ubicación:** [`app/api/auth/[...nextauth]/route.ts`](app/api/auth/[...nextauth]/route.ts:1)
- **Funcionalidades:**
  - Sesiones persistentes con NextAuth
  - Gestión de tokens de acceso
  - Proveedores de autenticación múltiples (Credentials, Azure AD)
  - Control de expiración de sesiones

---

### 2.2 Módulo de Gestión de Procesos

#### 2.2.1 Panel de Procesos

- **Ubicación:** [`app/process/page.tsx`](app/process/page.tsx:1)
- **Funcionalidades:**
  - Visualización de procesos disponibles por usuario
  - Búsqueda de procesos por nombre o descripción
  - Filtros por categoría (Administrativos, Técnicos, Financieros)
  - Vista de cuadrícula y lista
  - Tarjetas de procesos con información detallada
  - Navegación a subprocesos específicos
  - Skeletons de carga para mejor UX
  - Fondo animado con gradiente

#### 2.2.2 Componentes de Procesos

- **ProcessCard:** [`components/process/ProcessCard.tsx`](components/process/ProcessCard.tsx:1)

  - Tarjeta reutilizable para mostrar información de procesos
  - Acciones de clic para proceso y subprocesos
  - Badges de estado y categorías

- **ProcessSearch:** [`components/process/ProcessSearch.tsx`](components/process/ProcessSearch.tsx:1)

  - Barra de búsqueda con filtros
  - Búsqueda en tiempo real

- **ProcessFilters:** [`components/process/ProcessFilters.tsx`](components/process/ProcessFilters.tsx:1)
  - Filtros por categoría con contadores
  - Diseño responsive

---

### 2.3 Módulo de Mesa de Ayuda (Help Desk)

#### 2.3.1 Gestión de Tickets de Soporte

- **Ubicación:** [`app/process/help-desk/create-ticket/page.tsx`](app/process/help-desk/create-ticket/page.tsx:1)
- **Funcionalidades:**
  - Creación de nuevos tickets de soporte
  - Lista de tickets con filtros avanzados
  - Asignación de técnicos a tickets
  - Seguimiento de estado de tickets
  - Priorización (Alta, Media, Baja)
  - Dashboard con estadísticas en tiempo real

#### 2.3.2 Creación de Tickets

- **Formulario completo con:**
  - Tipo de solicitud (Incidente/Solicitud)
  - Prioridad del ticket
  - Empresa solicitante
  - Sitio (Administrativa, Planta, Celta)
  - Asunto del ticket
  - Categoría, Subcategoría y Actividad (cascada)
  - Departamento
  - Técnico asignado (opcional)
  - Descripción detallada
  - Validación de campos obligatorios

#### 2.3.3 Filtros de Búsqueda

- Por prioridad
- Por estado (Abierto, Resuelto, Cancelado)
- Por empresa
- Por técnico asignado
- Por rango de fechas

#### 2.3.4 Dashboard de Estadísticas

- Total de casos
- Casos resueltos
- Casos en progreso
- Casos de alta prioridad
- Gráficos de reportes (componente ReportsChart)

#### 2.3.5 API Endpoints

- **GET** [`/api/help-desk/tickets`](app/api/help-desk/tickets/route.js:1) - Listar tickets
- **POST** [`/api/help-desk/create_ticket`](app/api/help-desk/create_ticket/route.js:1) - Crear ticket
- **GET** [`/api/help-desk/categories`](app/api/help-desk/categories/route.js:1) - Obtener categorías
- **GET** [`/api/help-desk/subcategories`](app/api/help-desk/subcategories/route.js:1) - Obtener subcategorías
- **GET** [`/api/help-desk/activities`](app/api/help-desk/activities/route.js:1) - Obtener actividades
- **GET** [`/api/help-desk/departments`](app/api/help-desk/departments/route.js:1) - Obtener departamentos
- **GET** [`/api/help-desk/technical`](app/api/help-desk/technical/route.js:1) - Obtener técnicos
- **POST** [`/api/help-desk/notes`](app/api/help-desk/notes/route.js:1) - Agregar notas
- **POST** [`/api/help-desk/update_ticket`](app/api/help-desk/update_ticket/route.js:1) - Actualizar ticket

---

### 2.4 Módulo de Solicitudes Generales

#### 2.4.1 Gestión de Solicitudes

- **Ubicación:** [`app/process/request-general/create-request/page.tsx`](app/process/request-general/create-request/page.tsx:1)
- **Funcionalidades:**
  - Creación de solicitudes generales
  - Listado de solicitudes con filtros
  - Asignación de usuarios responsables
  - Seguimiento de estado
  - Adjuntar archivos mediante Microsoft Graph API

#### 2.4.2 Creación de Solicitudes

- **Formulario con:**
  - Empresa solicitante
  - Asunto de la solicitud
  - Categoría y Proceso (dependientes)
  - Descripción detallada
  - Archivos adjuntos (hasta 10 archivos)
  - Notificación por email automática al responsable

#### 2.4.3 Integración con Microsoft 365

- **Ubicación:** [`components/microsoft-365/useGetMicrosoftToken.jsx`](components/microsoft-365/useGetMicrosoftToken.jsx:1)
- **Funcionalidades:**
  - Autenticación OAuth 2.0 con Microsoft
  - Gestión de tokens de acceso
  - Subida de archivos a OneDrive/SharePoint
  - Creación automática de carpetas por solicitud

#### 2.4.4 Notificaciones por Email

- **Ubicación:** [`components/email/utils/sendMessage.js`](components/email/utils/sendMessage.js:1)
- **Funcionalidades:**
  - Envío de emails automáticos
  - Plantillas HTML personalizables
  - Notificación de asignación de solicitudes
  - Incluye tablas y datos formateados

#### 2.4.5 API Endpoints

- **GET** [`/api/requests-general`](app/api/requests-general/route.js:1) - Listar solicitudes
- **POST** [`/api/requests-general/create-request`](app/api/requests-general/create-request/route.js:1) - Crear solicitud
- **GET** [`/api/requests-general/consult-request`](app/api/requests-general/consult-request/route.js:1) - Consultar datos del formulario
- **GET** [`/api/requests-general/get-user-id`](app/api/requests-general/get-user-id/route.js:1) - Obtener ID de usuario
- **GET** [`/api/requests-general/view-request`](app/api/requests-general/view-request/route.js:1) - Ver solicitud
- **POST** [`/api/requests-general/update-request`](app/api/requests-general/update-request/route.js:1) - Actualizar solicitud
- **POST** [`/api/requests-general/notes`](app/api/requests-general/notes/route.js:1) - Agregar notas
- **POST** [`/api/requests-general/reassign`](app/api/requests-general/reassign/route.js:1) - Reasignar solicitud

---

### 2.5 Módulo de Solicitudes de Compra

#### 2.5.1 Gestión de Solicitudes de Compra

- **Ubicación:** [`app/process/purchases/purchase-request/page.tsx`](app/process/purchases/purchase-request/page.tsx:1)
- **Funcionalidades:**
  - Visualización de solicitudes de compra desde SAP
  - Autenticación con múltiples endpoints de SAP
  - Gestión de tokens de SAP
  - Filtrado por empresa y búsqueda
  - Paginación de resultados
  - Actualización en tiempo real

#### 2.5.2 Integración con SAP Business One

- **Ubicación:** [`lib/sap-context.tsx`](lib/sap-context.tsx:1)
- **Funcionalidades:**
  - Contexto React para gestión de tokens SAP
  - Almacenamiento en memoria con expiración
  - Autenticación automática cuando expira el token
  - Soporte para múltiples empresas

#### 2.5.3 API Endpoints

- **POST** [`/api/purchase-request/auth`](app/api/purchase-request/auth/route.ts:1) - Autenticar con SAP
- **POST** [`/api/purchase-request/drafts`](app/api/purchase-request/drafts/route.ts:1) - Obtener borradores de compra
- **GET** [`/api/purchase-request/access`](app/api/purchase-request/access/route.ts:1) - Verificar acceso a empresas

---

### 2.6 Módulo de Administración

#### 2.6.1 Gestión de Usuarios

- **Ubicación:** [`app/process/administration/users/page.tsx`](app/process/administration/users/page.tsx:1)
- **Funcionalidades:**
  - Listado de usuarios con paginación
  - Creación de nuevos usuarios
  - Edición de usuarios existentes
  - Desactivación de usuarios (soft delete)
  - Asignación de roles (Admin/User)
  - Asignación de subprocesos por empresa
  - Exportación a CSV
  - Filtros por nombre, email, rol y estado

#### 2.6.2 Asignación de Subprocesos

- Selección de empresa
- Búsqueda de subprocesos
- Selección múltiple de subprocesos
- Visualización de procesos padre
- Guardado de asignaciones

#### 2.6.3 API Endpoints

- **GET** [`/api/users`](app/api/users/route.ts:1) - Listar usuarios
- **POST** [`/api/users`](app/api/users/route.ts:1) - Crear usuario
- **PUT** [`/api/users/[id]`](app/api/users/[id]/route.ts:1) - Actualizar usuario
- **DELETE** [`/api/users/[id]`](app/api/users/[id]/route.ts:1) - Desactivar usuario
- **GET** [`/api/users/[id]/subprocesses`](app/api/users/[id]/subprocesses/route.ts:1) - Obtener subprocesos del usuario
- **POST** [`/api/users/[id]/subprocesses`](app/api/users/[id]/subprocesses/route.ts:1) - Asignar subprocesos

---

### 2.7 Módulo de Perfil de Usuario

#### 2.7.1 Configuración de Perfil

- **Ubicación:** [`app/profile/page.tsx`](app/profile/page.tsx:1)
- **Funcionalidades:**
  - Visualización de información del perfil
  - Actualización de nombre y email
  - Actualización de foto de perfil (URL)
  - Cambio de contraseña
  - Validación de contraseñas
  - Actualización de sesión en tiempo real

#### 2.7.2 Cambio de Contraseña

- Contraseña actual requerida
- Nueva contraseña con validación de fortaleza
- Confirmación de nueva contraseña
- Actualización automática de sesión

#### 2.7.3 API Endpoints

- **GET** [`/api/profile`](app/api/profile/route.ts:1) - Obtener perfil
- **PUT** [`/api/profile`](app/api/profile/route.ts:1) - Actualizar perfil
- **POST** [`/api/profile/change-password`](app/api/profile/change-password/route.ts:1) - Cambiar contraseña

---

### 2.8 Módulo de Gestión de Empresas

#### 2.8.1 Gestión de Empresas

- **API Endpoint:** [`/api/companies`](app/api/companies/route.ts:1)
- **Funcionalidades:**
  - Listado de empresas disponibles
  - Asociación de usuarios a empresas
  - Configuración de endpoints de SAP por empresa
  - Logos personalizados por empresa

---

### 2.9 Módulo de Gestión de Subprocesos

#### 2.9.1 Gestión de Subprocesos

- **API Endpoint:** [`/api/subprocesses`](app/api/subprocesses/route.ts:1)
- **Funcionalidades:**
  - Listado de subprocesos disponibles
  - Asociación con procesos padre
  - URLs personalizadas por subproceso
  - Asignación a usuarios y empresas

---

## 3. BASE DE DATOS

### 3.1 Esquema de Base de Datos

- **Ubicación:** [`prisma/schema.prisma`](prisma/schema.prisma:1)
- **Motor:** SQL Server
- **ORM:** Prisma 6.17.0

### 3.2 Principales Tablas

#### Tablas de Autenticación

- **User:** Usuarios del sistema
- **Account:** Cuentas de autenticación (NextAuth)
- **Session:** Sesiones activas
- **VerificationToken:** Tokens de verificación de email

#### Tablas de Negocio

- **Company:** Empresas del sistema
- **CompanyUser:** Relación usuarios-empresas
- **Process:** Procesos principales
- **Subprocess:** Subprocesos
- **SubprocessUserCompany:** Asignación de subprocesos a usuarios por empresa

#### Tablas de Mesa de Ayuda

- **Case:** Tickets de soporte
- **StatusCase:** Estados de casos
- **Active:** Tipos de activos
- **Department:** Departamentos
- **Category:** Categorías de tickets
- **Subcategory:** Subcategorías de tickets
- **Activity:** Actividades de tickets
- **CategoryCase:** Relación casos-categorías
- **Note:** Notas de casos
- **LogCaseHelpDesk:** Logs de casos

#### Tablas de SAP

- **sap_endpoints:** Configuración de endpoints de SAP por empresa

#### Tablas de Auditoría

- **UserAuditLog:** Logs de auditoría de usuarios

---

## 4. COMPONENTES DE UI REUTILIZABLES

### 4.1 Componentes Principales

#### Componentes de UI

- **GradientButton:** [`components/ui/GradientButton.tsx`](components/ui/GradientButton.tsx:1) - Botón con gradiente
- **GlassCard:** [`components/ui/GlassCard.tsx`](components/ui/GlassCard.tsx:1) - Tarjeta con efecto glassmorphism
- **StatusBadge:** [`components/ui/StatusBadge.tsx`](components/ui/StatusBadge.tsx:1) - Badge de estado
- **FileUpload:** [`components/ui/FileUpload.tsx`](components/ui/FileUpload.tsx:1) - Componente de subida de archivos

#### Componentes de Layout

- **Header:** [`components/Header.tsx`](components/Header.tsx:1) - Cabecera de la aplicación
- **AnimatedBackground:** [`components/layout/AnimatedBackground.tsx`](components/layout/AnimatedBackground.tsx:1) - Fondo animado

#### Componentes de Procesos

- **ProcessCard:** [`components/process/ProcessCard.tsx`](components/process/ProcessCard.tsx:1)
- **ProcessSearch:** [`components/process/ProcessSearch.tsx`](components/process/ProcessSearch.tsx:1)
- **ProcessFilters:** [`components/process/ProcessFilters.tsx`](components/process/ProcessFilters.tsx:1)
- **ProcessSkeleton:** [`components/process/ProcessSkeleton.tsx`](components/process/ProcessSkeleton.tsx:1)

#### Componentes de Help Desk

- **ReportsChart:** [`components/help-desk/ReportsChart.tsx`](components/help-desk/ReportsChart.tsx:1) - Gráficos de reportes
- **useHelpDeskAccess:** [`components/help-desk/hooks/useHelpDeskAccess.ts`](components/help-desk/hooks/useHelpDeskAccess.ts:1) - Hook de acceso

#### Contextos

- **Providers:** [`components/providers.tsx`](components/providers.tsx:1) - Proveedores globales
- **SAP Context:** [`lib/sap-context.tsx`](lib/sap-context.tsx:1) - Contexto de SAP
- **User Context:** [`lib/user-context.tsx`](lib/user-context.tsx:1) - Contexto de usuario
- **Access Control:** [`lib/access-control.ts`](lib/access-control.ts:1) - Control de acceso

---

## 5. CARACTERÍSTICAS TÉCNICAS

### 5.1 Seguridad

- Autenticación con NextAuth
- Encriptación de contraseñas con bcryptjs
- Tokens de sesión seguros
- Validación de permisos por usuario
- Control de acceso basado en roles (RBAC)
- Protección de rutas con middleware
- Auditoría de acciones de usuarios

### 5.2 Performance

- Server-side rendering con Next.js
- Optimización de imágenes con next/image
- Code splitting automático
- Skeletons de carga
- Caching de tokens SAP
- Paginación en listados
- Lazy loading de componentes

### 5.3 UX/UI

- Diseño responsive (mobile-first)
- Tema claro/oscuro
- Animaciones suaves
- Feedback visual en acciones
- Toasts de notificación (react-hot-toast)
- Modals para formularios
- Breadcrumbs de navegación
- Filtros expandibles
- Estados de carga claros

### 5.4 Internacionalización

- Interfaz en español
- Formatos de fecha localizados (es-CO)
- Moneda localizada

### 5.5 Accesibilidad

- Labels en formularios
- ARIA labels en elementos interactivos
- Navegación por teclado
- Contraste de colores adecuado
- Textos alternativos en imágenes

---

## 6. INTEGRACIONES EXTERNAS

### 6.1 Microsoft 365

- **Autenticación:** OAuth 2.0
- **API:** Microsoft Graph API
- **Funcionalidades:**
  - Autenticación de usuarios
  - Subida de archivos a OneDrive/SharePoint
  - Gestión de carpetas
  - Tokens de acceso con refresh

### 6.2 SAP Business One

- **Autenticación:** Basic Auth + Token
- **API:** Service Layer
- **Funcionalidades:**
  - Obtención de solicitudes de compra
  - Gestión de borradores
  - Soporte multi-empresa
  - Tokens con expiración

### 6.3 Email

- **API:** Servicio de email personalizado
- **Funcionalidades:**
  - Envío de notificaciones
  - Plantillas HTML
  - Tablas formateadas
  - Logos personalizados

---

## 7. ESTRUCTURA DEL PROYECTO

```
front-kronos/
├── app/                          # App Router de Next.js
│   ├── api/                      # API Routes
│   │   ├── auth/                 # Autenticación
│   │   ├── help-desk/            # Mesa de ayuda
│   │   ├── purchase-request/      # Solicitudes de compra
│   │   ├── requests-general/     # Solicitudes generales
│   │   ├── users/                # Gestión de usuarios
│   │   ├── companies/            # Gestión de empresas
│   │   ├── subprocesses/         # Gestión de subprocesos
│   │   └── profile/              # Perfil de usuario
│   ├── dashboard/                # Dashboard principal
│   ├── login/                    # Página de login
│   ├── register/                 # Página de registro
│   ├── process/                  # Módulo de procesos
│   │   ├── help-desk/            # Mesa de ayuda
│   │   ├── purchases/            # Compras
│   │   ├── request-general/      # Solicitudes generales
│   │   └── administration/       # Administración
│   └── profile/                  # Perfil de usuario
├── components/                   # Componentes React
│   ├── email/                    # Componentes de email
│   ├── help-desk/               # Componentes de mesa de ayuda
│   ├── layout/                  # Componentes de layout
│   ├── microsoft-365/            # Integración Microsoft
│   ├── process/                 # Componentes de procesos
│   └── ui/                      # Componentes UI genéricos
├── lib/                         # Utilidades y configuraciones
├── prisma/                      # Esquema de base de datos
├── public/                      # Archivos estáticos
└── emails/                      # Plantillas de email
```

---

## 8. CONFIGURACIÓN Y DEPLOYMENT

### 8.1 Variables de Entorno Requeridas

- `DATABASE_URL` - URL de conexión a SQL Server
- `SHADOW_DATABASE_URL` - URL de base de datos shadow para Prisma
- `NEXTAUTH_SECRET` - Secreto para NextAuth
- `NEXTAUTH_URL` - URL de la aplicación
- `MICROSOFTGRAPHUSERROUTE` - URL base de Microsoft Graph API
- `API_EMAIL` - URL del servicio de email

### 8.2 Scripts Disponibles

```json
{
  "dev": "next dev -p 8080 --turbopack",
  "build": "next build --turbopack",
  "start": "next start -p 3003",
  "lint": "eslint"
}
```

### 8.3 Puertos

- **Desarrollo:** 8080
- **Producción:** 3003

---

## 9. PRUEBAS Y VALIDACIÓN

### 9.1 Funcionalidades Probadas

- ✅ Autenticación de usuarios (credenciales y Azure AD)
- ✅ Gestión de procesos y subprocesos
- ✅ Creación y gestión de tickets de mesa de ayuda
- ✅ Creación y seguimiento de solicitudes generales
- ✅ Integración con Microsoft 365 (archivos)
- ✅ Integración con SAP Business One (solicitudes de compra)
- ✅ Administración de usuarios
- ✅ Asignación de subprocesos
- ✅ Gestión de perfil
- ✅ Cambio de contraseña
- ✅ Filtros y búsqueda en todos los módulos
- ✅ Paginación en listados
- ✅ Notificaciones por email
- ✅ Exportación a CSV

### 9.2 Navegadores Soportados

- Chrome (últimas 2 versiones)
- Firefox (últimas 2 versiones)
- Safari (últimas 2 versiones)
- Edge (últimas 2 versiones)

### 9.3 Dispositivos Soportados

- Desktop (1920px+)
- Laptop (1024px - 1919px)
- Tablet (768px - 1023px)
- Mobile (< 768px)

---

## 10. DOCUMENTACIÓN

### 10.1 Documentación de Código

- TypeScript con tipos definidos
- Comentarios en código crítico
- JSDoc en funciones complejas

### 10.2 README

- Instrucciones de instalación
- Scripts disponibles
- Información de dependencias

---

## 11. REQUISITOS DEL SISTEMA

### 11.1 Requisitos del Servidor

- Node.js 20+
- SQL Server 2016+
- Mínimo 2GB RAM
- Mínimo 10GB espacio en disco

### 11.2 Requisitos de Desarrollo

- Node.js 20+
- npm o yarn
- Git

---

## 12. MANTENIMIENTO Y SOPORTE

### 12.1 Actualizaciones

- Actualización de dependencias regular
- Parches de seguridad aplicados
- Next.js 15.5.4 (última versión estable)

### 12.2 Monitoreo

- Logs de errores en consola
- Auditoría de acciones de usuarios
- Logs de API endpoints

---

## 13. ENTREGABLES

### 13.1 Código Fuente

- ✅ Código fuente completo en TypeScript
- ✅ Configuración de Next.js
- ✅ Esquema de base de datos Prisma
- ✅ Componentes reutilizables
- ✅ API Routes

### 13.2 Documentación

- ✅ Acta de entrega (este documento)
- ✅ README con instrucciones
- ✅ Comentarios en código

### 13.3 Configuración

- ✅ package.json con dependencias
- ✅ tsconfig.json
- ✅ next.config.ts
- ✅ tailwind.config.mjs
- ✅ postcss.config.mjs

---

## 14. OBSERVACIONES Y RECOMENDACIONES

### 14.1 Recomendaciones para Producción

1. Configurar variables de entorno en un servicio seguro (ej. AWS Secrets Manager)
2. Implementar CDN para archivos estáticos
3. Configurar HTTPS obligatorio
4. Implementar backups automáticos de base de datos
5. Configurar monitoreo de errores (ej. Sentry)
6. Implementar CI/CD para despliegues
7. Configurar rate limiting en API endpoints
8. Implementar cache Redis para tokens SAP

### 14.2 Mejoras Futuras Sugeridas

1. Implementar tests unitarios y de integración
2. Agregar modo oscuro completo
3. Implementar notificaciones push
4. Agregar chat en vivo para soporte
5. Implementar dashboard analítico avanzado
6. Agregar exportación a PDF
7. Implementar firma digital en documentos
8. Agregar integración con más sistemas ERP

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

### 16.1 Dependencias Principales

- next: 15.5.4
- react: 19.1.0
- @mantine/core: 8.3.3
- next-auth: 4.24.11
- @prisma/client: 6.17.1
- prisma: 6.17.0
- typescript: 5

### 16.2 Licencia

© 2025 - Todos los derechos reservados

---

**ESTE DOCUMENTO CONSTITUYE EL ACTA OFICIAL DE ENTREGA DEL SOFTWARE FRONT-KRONOS VERSIÓN 0.1.0**
