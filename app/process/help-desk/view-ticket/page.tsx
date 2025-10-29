'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Title,
  Paper,
  Text,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Card,
  Textarea,
  TextInput,
  Select,
  Checkbox,
} from '@mantine/core';
import {
  IconCalendar,
  IconUser,
  IconBuilding,
  IconNote,
} from '@tabler/icons-react';

interface Ticket {
  id_case: number;
  case_type: string;
  subject_case: string;
  priority: string;
  category: string;
  subcategory: string;
  activity: string;
  department: string;
  place?: string;
  description: string;
  status: string;
  id_department?: string;
  id_category?: string;
  id_subcategory?: string;
  id_activity?: string;
  id_technical?: string;
  creation_date: string;
  nombreTecnico: string;
  subprocess_id: number;
}

interface Option {
  value: string;
  label: string;
}

interface Subcategory {
  id_subcategory: number;
  subcategory: string;
  id_category: number | null;
}

interface Activity {
  id_activity: number;
  activity: string;
  id_subcategory: number | null;
}  


function ViewTicketPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get('id');
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [categories, setCategories] = useState<Option[]>([]);
    const [subcategories, setSubcategories] = useState<Option[]>([]);
    const [activities, setActivities] = useState<Option[]>([]);
    const [technicals, setTechnicals] = useState<Option[]>([]);
    const [departments, setDepartments] = useState<Option[]>([]);
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [notes, setNotes] = useState<string[]>([]);
    const [newNote, setNewNote] = useState('');
    const [showResolution, setShowResolution] = useState(false);
    const [resolutionData, setResolutionData] = useState({
        estado: '',
        correo: '',
        resolucion: '',
    });

  useEffect(() => {
    const storedTicket = sessionStorage.getItem('selectedTicket');
    if (storedTicket) {
      setTicket(JSON.parse(storedTicket));
    } else if (id) {
      fetch(`/api/help-desk/tickets?id=${id}`)
        .then(res => res.json())
        .then(data => setTicket(data))
        .catch(err => console.error('Error fetching ticket:', err));
    }
  }, [id]);

  // Cuando se carga el ticket por primera vez
    useEffect(() => {
    if (ticket) {
        fetchOptions();
        fetchSubprocessUsers();
    }
    }, [ticket]);

    // Cuando cambia la categoría
    useEffect(() => {
    if (ticket?.category) {
        fetchSubcategories(ticket.category);
    }
    }, [ticket?.category]);

    useEffect(() => {
    if (ticket?.id_category) {
        fetchSubcategories(ticket.id_category);
    }
    }, [ticket?.id_category]);

    useEffect(() => {
    if (ticket?.id_subcategory) {
        fetchActivities(ticket.id_subcategory);
    }
    }, [ticket?.id_subcategory]);

  const fetchOptions = async () => {
    try {
      setLoadingOptions(true);
      const [categoriesRes, departmentsRes] = await Promise.all([
        fetch('/api/help-desk/categories'),
        fetch('/api/help-desk/departments'),
      ]);

      if (categoriesRes.ok) {
        const categoriesData: { id_category: number; category: string }[] = await categoriesRes.json();
        setCategories(categoriesData.map((cat) => ({ value: cat.id_category.toString(), label: cat.category })));
      }

      if (departmentsRes.ok) {
        const departmentsData: { id_department: number; department: string }[] = await departmentsRes.json();
        setDepartments(departmentsData.map((dep) => ({ value: dep.id_department.toString(), label: dep.department })));
      }
    } catch (error) {
      console.error('Error fetching options:', error);
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchSubcategories = async (categoryId: string) => {
  try {
    const response = await fetch(`/api/help-desk/subcategories?category_id=${categoryId}`);
    if (response.ok) {
      const data: Subcategory[] = await response.json();
      setSubcategories(
        data.map((sub) => ({
          value: sub.id_subcategory.toString(),
          label: sub.subcategory,
        }))
      );
    }
  } catch (error) {
    console.error('Error fetching subcategories:', error);
  }
};

  const fetchSubprocessUsers = async () => {
    console.log('Frontend - fetchSubprocessUsers called');
    try {
      const response = await fetch('/api/help-desk/technical');
      console.log('Frontend - fetchSubprocessUsers response status:', response.status);

      if (response.ok) {
        const data: {
          id_subprocess_user_company: number;
          subprocess: string;
          id_company_user: number;
          name: string;
        }[] = await response.json();

        console.log('Frontend - fetchSubprocessUsers received data:', data);

        setTechnicals(
          data.map((item) => ({
            value: item.id_subprocess_user_company.toString(),
            label: item.name,
          }))
        );
      } else {
        console.error('Frontend - fetchSubprocessUsers failed with status:', response.status);
      }
    } catch (error) {
      console.error('Error fetching subprocess users:', error);
    }
  };

  const fetchActivities = async (subcategoryId: string) => {
  try {
    const response = await fetch(`/api/help-desk/activities?subcategory_id=${subcategoryId}`);
    if (response.ok) {
      const data: Activity[] = await response.json();
      setActivities(
        data.map((act) => ({
          value: act.id_activity.toString(),
          label: act.activity,
        }))
      );
    }
  } catch (error) {
    console.error('Error fetching activities:', error);
  }
};

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    setNotes((prev) => [...prev, newNote.trim()]);
    setNewNote('');
  };

  const handleUpdateCase = () => {
    // Actualizacion Caso
    console.log('Actualizar caso con:', resolutionData);
  };

  if (!ticket) {
    return <div className="p-8 text-center text-gray-500">Cargando ticket...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
        <Group align="center" mb="md">
            <Title order={2} className="text-gray-800">
                Ticket #{ticket.id_case}
            </Title>
            <Badge
                color={
                    ticket.status === 'Cerrado'
                    ? 'gray'
                    : ticket.status === 'En progreso'
                    ? 'blue'
                    : 'green'
                }
                size="lg"
                radius="sm"
            >
                {ticket.status}
            </Badge>
        </Group>

        <Paper shadow="sm" p="xl" radius="md" withBorder>
            <Stack>
                <Group align="flex-start" justify="space-between">
                    <div className="flex-1">
                    <Text fw={600} size="lg" className="text-gray-800">
                        {ticket.subject_case}
                    </Text>
                    <Select
                        label="Tipo de Solicitud"
                        data={['Incidente', 'Solicitud']}
                        value={ticket.case_type}
                        onChange={(val) => setTicket({ ...ticket, case_type: val ?? '' })}
                        mt="xs"
                    />
                    </div>

                    <Group>
                        <Select
                            label="Prioridad"
                            data={['Baja', 'Media', 'Alta']}
                            value={ticket.priority}
                            onChange={(val) => setTicket({ ...ticket, priority: val ?? '' })}
                            className="min-w-[150px]"
                        />
                        <Select
                            label="Categoría"
                            data={categories}
                            value={ticket.id_category?.toString() || ''}
                            onChange={(val) =>
                                setTicket({
                                ...ticket,
                                id_category: val ?? '',
                                id_subcategory: '',
                                id_activity: '',
                                })
                            }
                            className="min-w-[150px]"
                        />
                        <Select
                            label="Subcategoría"
                            data={subcategories}
                            value={ticket.id_subcategory?.toString() || ''}
                            onChange={(val) =>
                                setTicket({
                                ...ticket,
                                id_subcategory: val ?? '',
                                id_activity: '',
                                })
                            }
                            className="min-w-[150px]"
                        />
                        <Select
                            label="Actividad"
                            data={activities}
                            value={ticket.id_activity?.toString() || ''}
                            onChange={(val) => setTicket({ ...ticket, id_activity: val ?? '' })}
                            className="min-w-[150px]"
                        />
                    </Group>
                </Group>

                <Divider />

                {/* Info general */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                        <IconCalendar size={16} className="text-gray-500" />
                        <Text>
                            <strong>Fecha de creación:</strong>{' '}
                            {ticket.creation_date.split('T')[0]}
                        </Text>
                    </div>
                    <div className="flex items-center gap-2">
                        <IconBuilding size={16} className="text-gray-500" />
                        <Select
                            label="Departamento"
                            data={departments}
                            placeholder="Departamento"
                            value={ticket.id_department?.toString() || ''}
                            onChange={(val) => setTicket({ ...ticket, id_department: val ?? '' })}
                            className="flex-1"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <IconUser size={16} className="text-gray-500" />
                        <Select
                            label="Técnico Asignado"
                            data={technicals}
                            placeholder="Nombre del técnico"
                            value={ticket.id_technical?.toString() || ''}
                            onChange={(val) => setTicket({ ...ticket, id_technical: val ?? '' })}
                            className="flex-1"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <IconBuilding size={16} className="text-gray-500" />
                        <Select
                            label="Sitio"
                            data={[
                                { value: 'Administrativa', label: 'Administrativa' },
                                { value: 'Planta', label: 'Planta' },
                                { value: 'Celta', label: 'Celta' },
                            ]}
                            placeholder="Sitio"
                            value={ticket.place || ''}
                            onChange={(val) => setTicket({ ...ticket, place: val ?? '' })}
                            className="flex-1"
                        />
                    </div>
                </div>

                <Divider />

                {/* Descripción */}
                <Card withBorder radius="md" shadow="xs" p="md" bg="gray.0">
                    <Text fw={600} mb={4}>
                    Descripción del caso:
                    </Text>
                    <Text size="sm" className="whitespace-pre-line text-gray-700">
                    {ticket.description}
                    </Text>
                </Card>

                <Card withBorder radius="md" shadow="xs" p="md" mt="md">
                    <Group mb="xs">
                        <IconNote size={18} className="text-blue-600" />
                        <Text fw={600}>Notas</Text>
                    </Group>

                    {notes.length > 0 ? (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2 mb-2 bg-gray-50">
                        {notes.map((note, i) => (
                        <Text key={i} size="sm" className="text-gray-700 mb-1">
                            • {note}
                        </Text>
                        ))}
                    </div>
                    ) : (
                    <Text size="sm" color="dimmed" mb="xs">
                        No hay notas registradas.
                    </Text>
                    )}

                    <Group align="flex-end">
                        <Textarea
                            placeholder="Escribe una nota..."
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            minRows={2}
                            className="flex-1"
                        />
                        <Button
                            variant="light"
                            onClick={handleAddNote}
                        >
                            Agregar
                        </Button>
                    </Group>
                </Card>

                <Checkbox
                    label="Agregar Resolución"
                    checked={showResolution}
                    onChange={(e) => setShowResolution(e.currentTarget.checked)}
                    mt="md"
                />

                {showResolution && (
                    <Card withBorder radius="md" shadow="xs" p="md" mt="md">
                        <Group grow>
                            <Select
                                label="Estado del caso"
                                placeholder="Selecciona estado"
                                data={['Resuelto', 'Cancelado']}
                                value={resolutionData.estado}
                                onChange={(val) =>
                                    setResolutionData({ ...resolutionData, estado: val || '' })
                                }
                            />
                            <TextInput
                                label="Correo electrónico"
                                placeholder="correo@empresa.com"
                                value={resolutionData.correo}
                                onChange={(e) =>
                                    setResolutionData({
                                    ...resolutionData,
                                    correo: e.currentTarget.value,
                                    })
                                }
                            />
                        </Group>

                        <Textarea
                            label="Resolución del caso"
                            placeholder="Describe la resolución aplicada..."
                            value={resolutionData.resolucion}
                            onChange={(e) =>
                            setResolutionData({
                                ...resolutionData,
                                resolucion: e.currentTarget.value,
                            })
                            }
                            minRows={3}
                            mt="md"
                        />

                        <Button
                            fullWidth
                            color="blue"
                            mt="md"
                            onClick={handleUpdateCase}
                        >
                            Actualizar caso
                        </Button>
                    </Card>
                )}
            </Stack>
        </Paper>

        <div className="mt-6 flex justify-end">
            <Button
                variant="light"
                onClick={() => router.back()}
            >
                Volver
            </Button>
        </div>
    </div>
  );
}

export default function TicketsViewBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ViewTicketPage />
    </Suspense>
  );
}
