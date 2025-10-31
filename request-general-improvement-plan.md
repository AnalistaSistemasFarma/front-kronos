# Request General Page Improvement Plan

## Overview

This document outlines the detailed design improvements for the `/process/request-general/create-request` page, implementing the successful visual design patterns from the help-desk module.

## Current State Analysis

### Issues with Current Implementation

1. **Basic Layout**: Simple div-based layout without visual hierarchy
2. **No Statistics**: No overview of request metrics
3. **Basic Table**: Plain table without visual enhancements
4. **Simple Modal**: Minimal form without proper validation or organization
5. **No Filtering**: No search or filter capabilities
6. **Limited Visual Feedback**: Minimal loading states or error handling

## Proposed Design Improvements

### 1. Enhanced Header Section

#### Current Implementation:

```jsx
<div className='mb-8'>
  <Title order={1} className='text-3xl font-bold text-gray-900 mb-2'>
    Solicitudes
  </Title>
  <p className='text-gray-600'>Vista y Administración de Solicitudes</p>
  <br />
  <Button onClick={() => setModalOpened(true)}>Crear Solicitud</Button>
</div>
```

#### Proposed Enhancement:

```jsx
<Card shadow='sm' p='xl' radius='md' withBorder mb='6' className='bg-white'>
  <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
    {breadcrumbItems}
  </Breadcrumbs>

  <Flex justify='space-between' align='center' mb='4'>
    <div>
      <Title order={1} className='text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3'>
        <IconFileDescription size={32} className='text-blue-600' />
        Solicitudes Generales
      </Title>
      <Text size='lg' color='gray.6'>
        Gestión y seguimiento de solicitudes generales
      </Text>
    </div>

    <Button
      onClick={() => setModalOpened(true)}
      size='lg'
      leftSection={<IconPlus size={18} />}
      className='bg-blue-600 hover:bg-blue-700'
    >
      Crear Nueva Solicitud
    </Button>
  </Flex>

  {/* Statistics Cards */}
  <Grid>
    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
      <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
        <Group>
          <IconFileDescription size={24} className='text-blue-600' />
          <div>
            <Text size='xs' color='blue.6'>
              Total de Solicitudes
            </Text>
            <Text size='lg' fw={600}>
              {tickets.length}
            </Text>
          </div>
        </Group>
      </Card>
    </Grid.Col>
    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
      <Card p='md' radius='md' withBorder className='bg-orange-50 border-orange-200'>
        <Group>
          <IconClock size={24} className='text-orange-600' />
          <div>
            <Text size='xs' color='orange.6'>
              Pendientes
            </Text>
            <Text size='lg' fw={600}>
              {tickets.filter((t) => t.status?.toLowerCase() === 'pendiente').length}
            </Text>
          </div>
        </Group>
      </Card>
    </Grid.Col>
    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
      <Card p='md' radius='md' withBorder className='bg-blue-50 border-blue-200'>
        <Group>
          <IconProgress size={24} className='text-blue-600' />
          <div>
            <Text size='xs' color='blue.6'>
              En Progreso
            </Text>
            <Text size='lg' fw={600}>
              {tickets.filter((t) => t.status?.toLowerCase() === 'en progreso').length}
            </Text>
          </div>
        </Group>
      </Card>
    </Grid.Col>
    <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
      <Card p='md' radius='md' withBorder className='bg-green-50 border-green-200'>
        <Group>
          <IconCheck size={24} className='text-green-600' />
          <div>
            <Text size='xs' color='green.6'>
              Completadas
            </Text>
            <Text size='lg' fw={600}>
              {tickets.filter((t) => t.status?.toLowerCase() === 'completada').length}
            </Text>
          </div>
        </Group>
      </Card>
    </Grid.Col>
  </Grid>
</Card>
```

### 2. Filter Section

#### Proposed Enhancement:

```jsx
<Card shadow='sm' p='lg' radius='md' withBorder mb='6' className='bg-white'>
  <Group justify='space-between' mb='md'>
    <Title order={3} className='flex items-center gap-2'>
      <IconFilter size={20} />
      Filtros de Búsqueda
    </Title>
    <ActionIcon
      variant='subtle'
      onClick={() => setFiltersExpanded(!filtersExpanded)}
      aria-label={filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}
    >
      {filtersExpanded ? <IconX size={16} /> : <IconFilter size={16} />}
    </ActionIcon>
  </Group>

  <Collapse in={filtersExpanded}>
    <Box mt='md'>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label='Estado'
            placeholder='Todos los estados'
            clearable
            data={[
              { value: 'Pendiente', label: 'Pendiente' },
              { value: 'En Progreso', label: 'En Progreso' },
              { value: 'Completada', label: 'Completada' },
            ]}
            value={filters.status}
            onChange={(value) => handleFilterChange('status', value || '')}
            leftSection={<IconFlag size={16} />}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label='Empresa'
            placeholder='Todas las empresas'
            clearable
            data={companies}
            value={filters.company}
            onChange={(value) => handleFilterChange('company', value || '')}
            leftSection={<IconBuilding size={16} />}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <TextInput
            label='Fecha Desde'
            type='date'
            value={filters.date_from}
            onChange={(e) => handleFilterChange('date_from', e.target.value)}
            leftSection={<IconCalendarEvent size={16} />}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <TextInput
            label='Fecha Hasta'
            type='date'
            value={filters.date_to}
            onChange={(e) => handleFilterChange('date_to', e.target.value)}
            leftSection={<IconCalendarEvent size={16} />}
          />
        </Grid.Col>
      </Grid>

      <Group justify='flex-end' mt='md'>
        <Button
          variant='outline'
          onClick={() =>
            setFilters({
              status: '',
              company: '',
              date_from: '',
              date_to: '',
            })
          }
          leftSection={<IconX size={16} />}
        >
          Limpiar Filtros
        </Button>
        <Button onClick={fetchTickets} leftSection={<IconRefresh size={16} />}>
          Aplicar Filtros
        </Button>
      </Group>
    </Box>
  </Collapse>
</Card>
```

### 3. Enhanced Table Design

#### Current Implementation:

```jsx
<Paper shadow='sm' radius='md' withBorder>
  <div className='overflow-x-auto'>
    <Table stickyHeader>{/* Basic table implementation */}</Table>
  </div>
</Paper>
```

#### Proposed Enhancement:

```jsx
<Card shadow='sm' radius='md' withBorder className='bg-white overflow-hidden'>
  <LoadingOverlay visible={loading} />

  <Title order={3} mb='md' className='flex items-center gap-2'>
    <IconFileDescription size={20} />
    Lista de Solicitudes
  </Title>

  <div className='overflow-x-auto'>
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>ID</Table.Th>
          <Table.Th>Empresa</Table.Th>
          <Table.Th>Estado</Table.Th>
          <Table.Th>Fecha de Solicitud</Table.Th>
          <Table.Th>Categoría</Table.Th>
          <Table.Th>Solicitado por</Table.Th>
          <Table.Th>Asignado a</Table.Th>
          <Table.Th>Descripción</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {tickets.length === 0 ? (
          <Table.Tr>
            <Table.Td colSpan={8} className='text-center py-12 text-gray-500'>
              <div className='flex flex-col items-center gap-3'>
                <IconFileDescription size={48} className='text-gray-300' />
                <Text size='lg' fw={500}>
                  No se encontraron solicitudes
                </Text>
                <Text size='sm' color='gray.500'>
                  Intenta ajustar los filtros o crea una nueva solicitud
                </Text>
              </div>
            </Table.Td>
          </Table.Tr>
        ) : (
          tickets.map((ticket) => (
            <Table.Tr key={ticket.id} className='cursor-pointer hover:bg-gray-50 transition-colors'>
              <Table.Td>
                <Badge variant='light' color='blue' size='sm'>
                  #{ticket.id}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <IconBuilding size={14} className='text-gray-400' />
                  <Text fw={500}>{ticket.company}</Text>
                </Group>
              </Table.Td>
              <Table.Td>
                <Badge color={getStatusColor(ticket.status)} variant='light' size='sm'>
                  {ticket.status}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size='sm'>{new Date(ticket.created_at).toISOString().split('T')[0]}</Text>
              </Table.Td>
              <Table.Td>
                <Text fw={500} className='max-w-xs truncate'>
                  {ticket.category}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <IconUser size={14} className='text-gray-400' />
                  <Text size='sm'>{ticket.requester}</Text>
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <IconUserCheck size={14} className='text-gray-400' />
                  <Text size='sm'>{ticket.user}</Text>
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size='sm' className='max-w-xs truncate' lineClamp={2}>
                  {ticket.description}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))
        )}
      </Table.Tbody>
    </Table>
  </div>
</Card>
```

### 4. Enhanced Modal Design

#### Current Implementation:

```jsx
<Modal
  opened={modalOpened}
  onClose={() => setModalOpened(false)}
  title='Crear Nuevo Ticket'
  size='lg'
>
  <Stack>{/* Basic form fields */}</Stack>
</Modal>
```

#### Proposed Enhancement:

```jsx
<Modal
  opened={modalOpened}
  onClose={() => {
    setModalOpened(false);
    setFormErrors({});
  }}
  title={
    <Group>
      <IconPlus size={20} />
      <Text size='lg' fw={600}>
        Crear Nueva Solicitud
      </Text>
    </Group>
  }
  size='xl'
  radius='md'
  overlayProps={{ blur: 4 }}
>
  <LoadingOverlay visible={createLoading} />

  <Stack>
    <Grid>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Select
          label='Empresa'
          placeholder='Seleccione la empresa'
          data={companies}
          value={formData.company}
          onChange={(value) => {
            handleFormChange('company', value || '');
            if (formErrors.company) {
              setFormErrors({ ...formErrors, company: '' });
            }
          }}
          error={formErrors.company}
          required
          leftSection={<IconBuilding size={16} />}
        />
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 6 }}>
        <Select
          label='Asignado a'
          placeholder='Seleccione a quien asignar esta solicitud'
          data={[
            { value: 'Catalina Sanchez', label: 'Catalina Sanchez' },
            { value: 'Camila Murillo', label: 'Camila Murillo' },
            { value: 'Lina Ramirez', label: 'Lina Ramirez' },
          ]}
          value={formData.usuario}
          onChange={(value) => {
            handleFormChange('usuario', value || '');
            if (formErrors.usuario) {
              setFormErrors({ ...formErrors, usuario: '' });
            }
          }}
          error={formErrors.usuario}
          required
          leftSection={<IconUserCheck size={16} />}
        />
      </Grid.Col>
    </Grid>

    <TextInput
      label='Categoría'
      placeholder='Ingrese la categoría que necesite'
      value={formData.category}
      onChange={(e) => {
        setFormData({ ...formData, category: e.target.value });
        if (formErrors.category) {
          setFormErrors({ ...formErrors, category: '' });
        }
      }}
      error={formErrors.category}
      required
      maxLength={100}
      description='Máximo 100 caracteres'
      leftSection={<IconTag size={16} />}
    />

    <Textarea
      label='Descripción Detallada'
      placeholder='Describa detalladamente la solicitud. Incluya toda la información relevante para una mejor atención.'
      value={formData.descripcion}
      onChange={(e) => {
        setFormData({ ...formData, descripcion: e.target.value });
        if (formErrors.descripcion) {
          setFormErrors({ ...formErrors, descripcion: '' });
        }
      }}
      error={formErrors.descripcion}
      required
      minRows={5}
      maxLength={1000}
      description='Mínimo 10 caracteres, máximo 1000 caracteres'
      autosize
      leftSection={<IconFileDescription size={16} />}
    />

    <Divider />

    <Group justify='flex-end' gap='md'>
      <Button
        variant='outline'
        onClick={() => {
          setModalOpened(false);
          setFormErrors({});
        }}
        size='md'
      >
        Cancelar
      </Button>
      <Button
        onClick={handleCreateTicketWithValidation}
        loading={createLoading}
        size='md'
        leftSection={<IconPlus size={16} />}
        className='bg-blue-600 hover:bg-blue-700'
      >
        Crear Solicitud
      </Button>
    </Group>
  </Stack>
</Modal>
```

## Required Icon Imports

```jsx
import {
  IconAlertCircle,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconFilter,
  IconX,
  IconCheck,
  IconRefresh,
  IconFileDescription,
  IconCalendarEvent,
  IconUser,
  IconFlag,
  IconClock,
  IconBuilding,
  IconProgress,
  IconUserCheck,
  IconTag,
} from '@tabler/icons-react';
```

## Additional State Management

```jsx
const [filters, setFilters] = useState({
  status: '',
  company: '',
  date_from: '',
  date_to: '',
});
const [filtersExpanded, setFiltersExpanded] = useState(false);
const [formErrors, setFormErrors] = useState<Record<string, string>>({});
```

## Validation Functions

```jsx
const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pendiente':
      return 'orange';
    case 'en progreso':
      return 'blue';
    case 'completada':
      return 'green';
    default:
      return 'gray';
  }
};

const validateForm = () => {
  const errors: Record<string, string> = {};

  if (!formData.company) {
    errors.company = 'La empresa es obligatoria';
  }
  if (!formData.usuario) {
    errors.usuario = 'El usuario asignado es obligatorio';
  }
  if (!formData.category.trim()) {
    errors.category = 'La categoría es obligatoria';
  }
  if (!formData.descripcion.trim()) {
    errors.descripcion = 'La descripción es obligatoria';
  } else if (formData.descripcion.trim().length < 10) {
    errors.descripcion = 'La descripción debe tener al menos 10 caracteres';
  }

  setFormErrors(errors);
  return Object.keys(errors).length === 0;
};

const handleCreateTicketWithValidation = async () => {
  if (!validateForm()) {
    return;
  }
  await handleCreateTicket();
};
```

## Benefits of These Improvements

1. **Better Visual Hierarchy**: Clear structure with cards, proper spacing, and visual grouping
2. **Enhanced User Experience**: Statistics provide immediate overview, filters enable quick access
3. **Improved Usability**: Icons, hover effects, and visual feedback make the interface more intuitive
4. **Consistent Design**: Matches the successful patterns from the help-desk module
5. **Better Data Presentation**: Enhanced table with visual indicators and better organization
6. **Professional Appearance**: Modern, clean design that follows best practices

## Implementation Priority

1. **High Priority**: Header section with statistics cards
2. **High Priority**: Enhanced table design
3. **Medium Priority**: Filter section
4. **Medium Priority**: Modal improvements
5. **Low Priority**: Additional enhancements and refinements

This comprehensive improvement plan will transform the request-general page into a modern, user-friendly interface that matches the quality and usability of the help-desk module.
