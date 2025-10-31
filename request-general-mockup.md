# Request General Page - Visual Design Mockup

## Before and After Comparison

### Current State (Before)

```
┌─────────────────────────────────────────────────────────────┐
| Solicitudes                                                  |
| Vista y Administración de Solicitudes                        |
|                                                             |
| [Crear Solicitud]                                           |
|                                                             |
| ┌─────────────────────────────────────────────────────────┐ |
| | ID  | Empresa  | Estado  | Fecha  | Categoria  | ...    | |
| |-----|----------|---------|--------|------------|--------| |
| | 001 | CompanyA | Pendiente| 2024-01| CategoryA  | ...    | |
| | 002 | CompanyB | Completada| 2024-02| CategoryB  | ...    | |
| └─────────────────────────────────────────────────────────┘ |
└─────────────────────────────────────────────────────────────┘
```

### Proposed Design (After)

```
┌─────────────────────────────────────────────────────────────┐
| Procesos > Solicitudes Generales > Panel de Solicitudes     |
|                                                             |
| 📄 Solicitudes Generales                                    |
| Gestión y seguimiento de solicitudes generales              |
|                                                    [Crear+] |
|                                                             |
| ┌─────────┬─────────┬─────────┬─────────────────────────┐   |
| | 📄 Total | ⏰ Pend. | 🔄 Prog.| ✅ Compl.              |   |
| |    25    |    8    |    7    |    10                  |   |
| └─────────┴─────────┴─────────┴─────────────────────────┘   |
|                                                             |
| 🔍 Filtros de Búsqueda                           [▼]        |
| ┌─────────────────────────────────────────────────────────┐ |
| | Estado: [Todas ▼]  Empresa: [Todas ▼]  Fecha: [____]   | |
| |                                                    [Limpiar][Aplicar] | |
| └─────────────────────────────────────────────────────────┘ |
|                                                             |
| 📄 Lista de Solicitudes                                     |
| ┌─────────────────────────────────────────────────────────┐ |
| | ID   | Empresa   | Estado    | Fecha   | Solicitante | ... | |
| |------|-----------|-----------|---------|-------------|-----| |
| | #001 | 🏢 CompA | 🟠 Pend.  | 2024-01 | 👤 UserA    | ... | |
| | #002 | 🏢 CompB | 🟢 Comp.  | 2024-02 | 👤 UserB    | ... | |
| └─────────────────────────────────────────────────────────┘ |
└─────────────────────────────────────────────────────────────┘
```

## Detailed Component Breakdown

### 1. Header Section with Statistics

```
┌─────────────────────────────────────────────────────────────┐
| Procesos > Solicitudes Generales > Panel de Solicitudes     |
|                                                             |
| 📄 Solicitudes Generales                                    |
| Gestión y seguimiento de solicitudes generales              |
|                                                    [Crear+] |
|                                                             |
| ┌─────────┬─────────┬─────────┬─────────────────────────┐   |
| | 📄 Total | ⏰ Pend. | 🔄 Prog.| ✅ Compl.              |   |
| |    25    |    8    |    7    |    10                  |   |
| | Total de | Pendient| En Prog.| Completadas            |   |
| | Solicit. | es       | reso     |                       |   |
| └─────────┴─────────┴─────────┴─────────────────────────┘   |
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**

- Breadcrumb navigation for clear context
- Page title with relevant icon
- Descriptive subtitle
- Prominent create button with icon
- Four statistics cards with:
  - Relevant icons for each metric
  - Color-coded backgrounds (blue, orange, blue, green)
  - Clear labels and counts
  - Responsive grid layout

### 2. Filter Section

```
┌─────────────────────────────────────────────────────────────┐
| 🔍 Filtros de Búsqueda                           [▼]        |
|                                                             |
| ┌─────────────────────────────────────────────────────────┐ |
| | Estado: [Todas ▼]  Empresa: [Todas ▼]                  | |
| |                                                         | |
| | Fecha Desde: [____]  Fecha Hasta: [____]               | |
| |                                                         | |
| |                                              [Limpiar][Aplicar] | |
| └─────────────────────────────────────────────────────────┘ |
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**

- Collapsible section with toggle button
- Icon in section header
- Grid layout for filter controls
- Clear and apply buttons
- Icons for each filter field
- Responsive layout

### 3. Enhanced Table

```
┌─────────────────────────────────────────────────────────────┐
| 📄 Lista de Solicitudes                                     |
|                                                             |
| ┌─────┬──────────┬──────────┬─────────┬─────────────┬─────┐ |
| | ID  | Empresa  | Estado   | Fecha   | Solicitante | ... | |
| |─────┼──────────┼──────────┼─────────┼─────────────┼─────┤ |
| | #001| 🏢 CompA | 🟠 Pend. | 2024-01 | 👤 UserA    | ... | |
| | #002| 🏢 CompB | 🟢 Comp. | 2024-02 | 👤 UserB    | ... | |
| └─────┴──────────┴──────────┴─────────┴─────────────┴─────┘ |
|                                                             |
| 📄 ⏰ No se encontraron solicitudes                          |
|    Intenta ajustar los filtros o crea una nueva solicitud   |
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**

- Section title with icon
- Visual status indicators (badges with colors)
- Icons for company and user columns
- Hover effects on rows
- Empty state with helpful message
- Loading overlay during data fetch

### 4. Enhanced Modal

```
┌─────────────────────────────────────────────────────────────┐
| ➕ Crear Nueva Solicitud                                     |
|                                                             |
| ┌─────────────────┬───────────────────────────────────────┐ |
| | 🏢 Empresa      | 👤 Asignado a                        | |
| | [Seleccione ▼]  | [Seleccione ▼]                      | |
| └─────────────────┴───────────────────────────────────────┘ |
|                                                             |
| 🏷️ Categoría                                                |
| [Ingrese la categoría que necesite]                         |
|                                                             |
| 📄 Descripción Detallada                                    |
| [Describa detalladamente la solicitud...]                    |
|                                                             |
|                                              [Cancelar][Crear] |
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**

- Larger modal size (xl)
- Grid layout for form fields
- Icons for each form field
- Real-time validation feedback
- Loading state during submission
- Better button organization

## Color Scheme and Visual Design

### Primary Colors

- **Blue**: Primary actions, headers, total requests
- **Orange**: Pending items, warnings
- **Green**: Completed items, success states
- **Gray**: Inactive states, secondary information

### Visual Hierarchy

1. **Header Section**: Most prominent, with statistics
2. **Filter Section**: Secondary, collapsible
3. **Table Section**: Main content area
4. **Modal**: Overlay, highest z-index when active

### Spacing and Layout

- **Card Padding**: xl (24px)
- **Section Margin**: 6 (24px)
- **Grid Gaps**: Responsive (md: 16px)
- **Component Spacing**: md (16px)

## Responsive Design

### Desktop (≥ 768px)

- Statistics: 4 columns
- Filters: 4 columns
- Table: Full width
- Modal: xl size

### Tablet (≥ 576px)

- Statistics: 2x2 grid
- Filters: 2x2 grid
- Table: Horizontal scroll
- Modal: lg size

### Mobile (< 576px)

- Statistics: Single column
- Filters: Single column
- Table: Horizontal scroll
- Modal: Full screen

## Interaction Patterns

### Hover Effects

- Table rows: Light gray background
- Buttons: Slightly darker shade
- Cards: Subtle shadow increase

### Loading States

- Page: Full-page loader
- Table: Overlay with spinner
- Modal: Button loading state
- Forms: Field-level loading

### Error Handling

- Form validation: Inline error messages
- API errors: Alert notifications
- Empty states: Helpful messages with icons

## Accessibility Features

### Keyboard Navigation

- Tab order follows visual hierarchy
- Focus indicators on all interactive elements
- Modal focus trapping

### Screen Reader Support

- Semantic HTML structure
- ARIA labels and descriptions
- Icon meaning conveyed through text

### Visual Accessibility

- High contrast ratios
- Clear typography
- Color not the only indicator of state

This comprehensive design transformation will significantly improve the user experience and bring the request-general module to the same quality level as the help-desk module.
