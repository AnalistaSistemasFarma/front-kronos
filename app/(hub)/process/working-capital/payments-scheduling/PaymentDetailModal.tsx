'use client';

import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Badge,
  Card,
  Grid,
  Divider,
  ActionIcon,
  Tooltip,
  Loader,
  Alert,
  ThemeIcon,
  LoadingOverlay,
  Box,
  Button,
  Table,
  ScrollArea,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBuilding,
  IconUser,
  IconCalendarEvent,
  IconEye,
  IconDownload,
  IconAlertCircle,
  IconCashBanknote,
  IconClipboardList,
  IconNotes,
  IconPaperclip,
  IconFile,
  IconUserCheck,
  IconCategory,
  IconTag,
  IconClock,
  IconCircleCheck,
} from '@tabler/icons-react';
import axios from 'axios';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../../components/microsoft-365/useGetMicrosoftToken';
import {
  TABLE_FIELD_TYPE,
  parseTableConfig,
  parseTableValue,
} from '../../../../../lib/requests-general/tableField';
import { ORION_SIGNATURE_FIELD_TYPE } from '../../../../../lib/orion/fieldType';

interface RequestSummary {
  id_tarea: number;
  tarea: string;
  id_solicitud: number;
  id_estado_solicitud: number;
  estado_tarea: string;
  id_asignado_tarea: number;
  usuario_asignado: string;
  fecha_inicio_tarea?: string | null;
  fecha_fin_tarea?: string | null;
  activo?: number | null;
  resolución_tarea?: string | null;
  fecha_resolucion_tarea?: string | null;
  proceso_solicitud?: string | null;
  asunto_solicitud?: string | null;
  creador_solicitud?: string | null;
  descripción_solicitud?: string | null;
  id_empresa?: number | null;
  empresa?: string | null;
  fecha_creación_solicitud: string;
  id_creador_solicitud?: string | null;
  tipo_solicitud?: string | null;
  subtipo_solicitud?: string | null;
  valor_pagar?: number | null;
  fecha_solicitada_pago: string;
  acreedor?: string | null;
}

interface DetailData {
  subject_request?: string;
  company?: string;
  requester?: string;
  usuario?: string;
  category?: string;
  process?: string;
  description?: string;
  created_at?: string;
}

interface FormValue {
  id: number;
  field_label: string;
  field_type?: string | null;
  config_json?: string | null;
  option_label: string | null;
  value_text: string | null;
}

interface NoteItem {
  id_note: number;
  note: string;
  createdBy: string;
  creation_date: string;
}

interface FolderFile {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  webUrl: string;
  '@microsoft.graph.downloadUrl'?: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  request: RequestSummary | null;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Sin Empezar':
      return 'yellow';
    case 'Resuelto':
      return 'green';
    case 'Devuelta':
      return 'red';
    case 'Cancelado':
      return 'red';
    default:
      return 'gray';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'Sin Empezar':
      return 'Pendiente';
    case 'Resuelto':
      return 'Programado';
    case 'Devuelta':
      return 'Rechazado';
    case 'Cancelado':
      return 'Cancelado';
    default:
      return status;
  }
};

const formatCurrency = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
};

const splitAcreedor = (value?: string | null): { doc: string; name: string } => {
  const raw = String(value || '').trim();
  if (!raw) return { doc: '', name: '' };
  const idx = raw.indexOf(' - ');
  if (idx === -1) return { doc: '', name: raw };
  return { doc: raw.slice(0, idx).trim(), name: raw.slice(idx + 3).trim() };
};

const formatDateCO = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(new Date(value).getTime() + 5 * 60 * 60 * 1000));
  } catch {
    return String(value);
  }
};

const formatFileSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatFieldValue = (label: string, value: string) => {
  if (/valor a pagar|monto/i.test(label)) {
    const n = Number(String(value).replace(/[.\s]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n.toLocaleString('es-CO');
  }
  return value;
};

export default function PaymentDetailModal({ opened, onClose, request }: Props) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [formValues, setFormValues] = useState<FormValue[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);

  const [files, setFiles] = useState<FolderFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const idReqGen = request?.id_solicitud;

  useEffect(() => {
    if (!opened || !idReqGen) return;
    let active = true;

    // Reset al abrir.
    setError(null);
    setDetail(null);
    setFormValues([]);
    setNotes([]);
    setFiles([]);
    setFilesError(null);

    // Datos internos (SQL): detalle + valores del formulario + notas.
    const loadData = async () => {
      setLoading(true);
      try {
        const fetches: Promise<Response>[] = [
          fetch(`/api/requests-general/view-request?id=${idReqGen}`),
          fetch(`/api/requests-general/request-form-values?id_request=${idReqGen}`),
          fetch(`/api/requests-general/notes?id_request=${idReqGen}`),
        ];

        const responses = await Promise.all(fetches);
        const detailRes = responses[0];
        const valuesRes = responses[1];
        const notesRes = responses[2];

        const detailJson = await detailRes.json().catch(() => null);
        const valuesJson = await valuesRes.json().catch(() => []);
        const notesJson = notesRes ? await notesRes.json().catch(() => []) : [];
        if (!active) return;

        if (!detailRes.ok) {
          setError(detailJson?.error || 'No se pudo cargar el detalle de la solicitud.');
        } else {
          setDetail(detailJson);
        }
        // Nunca volcar payloads Orion (firmantes / estado) en este modal.
        const values = Array.isArray(valuesJson) ? valuesJson : [];
        setFormValues(
          values.filter(
            (fv: FormValue) =>
              fv.field_type !== ORION_SIGNATURE_FIELD_TYPE &&
              (!!fv.value_text || !!fv.option_label)
          )
        );
        setNotes(Array.isArray(notesJson) ? notesJson : []);
      } catch {
        if (active) setError('No se pudo cargar el detalle de la solicitud.');
      } finally {
        if (active) setLoading(false);
      }
    };

    // Adjuntos de la solicitud en OneDrive.
    const loadFiles = async () => {
      setFilesLoading(true);
      try {
        const token = await getMicrosoftToken();
        if (!token) throw new Error('sin token');
        const res = await axios.get(
          `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/SG/Request-${idReqGen}:/children`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!active) return;
        const items: FolderFile[] = (res.data?.value ?? []).filter(
          (it: { file?: unknown }) => it.file
        );
        setFiles(items);
      } catch {
        // La carpeta puede no existir (404) o no haber token: se muestra "Sin adjuntos".
        if (active) setFilesError('Sin adjuntos');
      } finally {
        if (active) setFilesLoading(false);
      }
    };

    loadData();
    loadFiles();

    return () => {
      active = false;
    };
  }, [opened, idReqGen]);

  const subject = detail?.subject_request || request?.asunto_solicitud || '';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size='xl'
      fullScreen={isMobile}
      title={
        <Group gap='xs' wrap='nowrap'>
          <ThemeIcon variant='light' color='indigo' radius='xl'>
            <IconClipboardList size={18} />
          </ThemeIcon>
          <Text fw={700}>Detalle de la solicitud {request ? `#${request.id_solicitud}` : ''}</Text>
        </Group>
      }
    >
      <Box pos='relative' mih={120}>
        <LoadingOverlay visible={loading} zIndex={5} overlayProps={{ blur: 1 }} />

        {error ? (
          <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
            {error}
          </Alert>
        ) : (
          <Stack gap='md'>
            {/* Encabezado */}
            <div>
              <Group justify='space-between' align='flex-start' wrap='nowrap'>
                <Text fw={600} size='lg' style={{ flex: 1 }}>
                  {subject || '—'}
                </Text>
                {request && (
                  <Badge variant='light' color={getStatusColor(request.estado_tarea)} size='lg'>
                    {getStatusLabel(request.estado_tarea)}
                  </Badge>
                )}
              </Group>
            </div>

            <Divider />

            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconBuilding size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Empresa</Text>
                </Group>
                <Text size='sm' fw={600}>{detail?.company || request?.empresa || '—'}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconUser size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Solicitante</Text>
                </Group>
                <Text size='sm' fw={600}>{detail?.requester || request?.creador_solicitud || '—'}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconUserCheck size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Asignado</Text>
                </Group>
                <Text size='sm' fw={600}>{request?.usuario_asignado || '—'}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconCategory size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Categoría / Proceso</Text>
                </Group>
                <Text size='sm' fw={600}>
                  {[detail?.category, detail?.process].filter(Boolean).join(' · ') || '—'}
                </Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconCalendarEvent size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Fecha de creación</Text>
                </Group>
                <Text size='sm' fw={600}>{formatDateCO(detail?.created_at || request?.fecha_creación_solicitud)}</Text>
              </Grid.Col>
            </Grid>

            {request && (
              <Card withBorder radius='md' p='md' bg='var(--mantine-color-blue-light)'>
                <Group gap={6} mb='sm'>
                  <IconCashBanknote size={18} className='text-blue-600' />
                  <Text fw={700}>Programación de Pago</Text>
                </Group>

                <Group justify='space-between' align='flex-end' wrap='nowrap' mb='sm'>
                  <div>
                    <Text size='xs' c='dimmed' fw={500} tt='uppercase'>Valor a pagar</Text>
                    <Text fw={700} style={{ fontSize: '1.5rem', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(request.valor_pagar)}
                    </Text>
                  </div>
                  <Badge variant='filled' color={getStatusColor(request.estado_tarea)} size='lg'>
                    {getStatusLabel(request.estado_tarea)}
                  </Badge>
                </Group>

                <Divider mb='sm' />

                <Grid>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Group gap={6} wrap='nowrap'>
                      <IconTag size={16} className='text-gray-400' />
                      <Text size='xs' c='dimmed' fw={500}>Tipo / Subtipo</Text>
                    </Group>
                    <Text size='sm' fw={600}>
                      {[request.tipo_solicitud, request.subtipo_solicitud].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Group gap={6} wrap='nowrap'>
                      <IconUser size={16} className='text-gray-400' />
                      <Text size='xs' c='dimmed' fw={500}>Acreedor</Text>
                    </Group>
                    {(() => {
                      const a = splitAcreedor(request.acreedor);
                      return (
                        <>
                          <Text size='sm' fw={600}>{a.name || '—'}</Text>
                          {a.doc && <Text size='xs' c='dimmed'>{a.doc}</Text>}
                        </>
                      );
                    })()}
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Group gap={6} wrap='nowrap'>
                      <IconCalendarEvent size={16} className='text-gray-400' />
                      <Text size='xs' c='dimmed' fw={500}>Fecha solicitada de pago</Text>
                    </Group>
                    <Text size='sm' fw={600}>{formatDateCO(request.fecha_solicitada_pago)}</Text>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Group gap={6} wrap='nowrap'>
                      <IconUserCheck size={16} className='text-gray-400' />
                      <Text size='xs' c='dimmed' fw={500}>Asignado a la tarea</Text>
                    </Group>
                    <Text size='sm' fw={600}>{request.usuario_asignado || '—'}</Text>
                  </Grid.Col>
                  {request.fecha_resolucion_tarea && (
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Group gap={6} wrap='nowrap'>
                        <IconCircleCheck size={16} className='text-gray-400' />
                        <Text size='xs' c='dimmed' fw={500}>Fecha de resolución</Text>
                      </Group>
                      <Text size='sm' fw={600}>{formatDateCO(request.fecha_resolucion_tarea)}</Text>
                    </Grid.Col>
                  )}
                </Grid>

                {request.resolución_tarea && (
                  <>
                    <Divider my='sm' />
                    <Group gap={6} wrap='nowrap' mb={2}>
                      <IconClock size={16} className='text-gray-400' />
                      <Text size='xs' c='dimmed' fw={500}>Resolución de la programación</Text>
                    </Group>
                    <Text size='sm' fw={500} style={{ whiteSpace: 'pre-line' }}>
                      {request.resolución_tarea}
                    </Text>
                  </>
                )}
              </Card>
            )}

            {detail?.description && (
              <Card withBorder radius='md' p='sm' bg='var(--mantine-color-gray-0)'>
                <Text size='xs' c='dimmed' fw={500} mb={4}>Descripción</Text>
                <Text size='sm' style={{ whiteSpace: 'pre-line' }}>{detail.description}</Text>
              </Card>
            )}

            {formValues.length > 0 && (
              <div>
                <Group gap={6} mb='xs'>
                  <IconCashBanknote size={18} className='text-gray-500' />
                  <Text fw={600}>Información adicional</Text>
                </Group>
                <Grid>
                  {formValues.map((fv, index) => {
                    // Campo tipo tabla: renderizar como tabla, no como JSON crudo.
                    if (fv.field_type === TABLE_FIELD_TYPE) {
                      const columns = parseTableConfig(fv.config_json).columns;
                      const rows = parseTableValue(fv.value_text).rows;
                      const renderCell = (value: unknown) => {
                        if (value === true) return 'Sí';
                        if (value === false) return 'No';
                        if (value === undefined || value === null || value === '') return '—';
                        return String(value);
                      };
                      return (
                        <Grid.Col
                          span={12}
                          key={`auth-fv-${fv.id ?? 'x'}-${fv.field_label ?? index}-${index}`}
                        >
                          <Card withBorder radius='md' p='sm'>
                            <Text size='xs' c='dimmed' fw={500} tt='uppercase' mb='xs'>
                              {fv.field_label}
                            </Text>
                            {columns.length === 0 || rows.length === 0 ? (
                              <Text size='sm' c='dimmed'>Sin datos.</Text>
                            ) : (
                              <ScrollArea>
                                <Table withTableBorder withColumnBorders striped>
                                  <Table.Thead>
                                    <Table.Tr>
                                      {columns.map((col) => (
                                        <Table.Th key={col.key}>{col.label}</Table.Th>
                                      ))}
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {rows.map((row, ri) => (
                                      <Table.Tr key={ri}>
                                        {columns.map((col) => (
                                          <Table.Td key={col.key}>{renderCell(row[col.key])}</Table.Td>
                                        ))}
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </ScrollArea>
                            )}
                          </Card>
                        </Grid.Col>
                      );
                    }

                    const raw = fv.option_label || fv.value_text || '';
                    const shown = raw ? formatFieldValue(fv.field_label, raw) : '—';
                    return (
                      <Grid.Col
                        span={{ base: 12, sm: 6 }}
                        key={`auth-fv-${fv.id ?? 'x'}-${fv.field_label ?? index}-${index}`}
                      >
                        <Card withBorder radius='md' p='sm'>
                          <Text size='xs' c='dimmed' fw={500} tt='uppercase'>
                            {fv.field_label}
                          </Text>
                          <Text size='sm' fw={600} mt={2}>
                            {shown}
                          </Text>
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </div>
            )}
                
            <div>
                <Group gap={6} mb='xs'>
                <IconPaperclip size={18} className='text-gray-500' />
                <Text fw={600}>Adjuntos</Text>
                {filesLoading && <Loader size={14} />}
                </Group>
                {!filesLoading && files.length === 0 ? (
                <Text size='sm' c='dimmed'>{filesError || 'Sin adjuntos'}</Text>
                ) : (
                <Stack gap='xs'>
                    {files.map((file, index) => (
                    <Card
                        key={`auth-file-${file.id ?? 'x'}-${index}`}
                        withBorder
                        radius='md'
                        p='xs'
                    >
                        <Group justify='space-between' wrap='nowrap'>
                        <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
                            <IconFile size={18} className='text-gray-400' />
                            <div style={{ minWidth: 0 }}>
                            <Text size='sm' fw={500} truncate>{file.name}</Text>
                            <Text size='xs' c='dimmed'>
                                {formatFileSize(file.size)} · {formatDateCO(file.lastModifiedDateTime)}
                            </Text>
                            </div>
                        </Group>
                        <Group gap={4} wrap='nowrap'>
                            <Tooltip label='Ver'>
                            <ActionIcon
                                variant='light'
                                color='blue'
                                component='a'
                                href={file.webUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <IconEye size={16} />
                            </ActionIcon>
                            </Tooltip>
                            {file['@microsoft.graph.downloadUrl'] && (
                            <Tooltip label='Descargar'>
                                <ActionIcon
                                variant='light'
                                color='gray'
                                component='a'
                                href={file['@microsoft.graph.downloadUrl']}
                                target='_blank'
                                rel='noopener noreferrer'
                                >
                                <IconDownload size={16} />
                                </ActionIcon>
                            </Tooltip>
                            )}
                        </Group>
                        </Group>
                    </Card>
                    ))}
                </Stack>
                )}
            </div>

            <div>
                <Group gap={6} mb='xs'>
                <IconNotes size={18} className='text-gray-500' />
                <Text fw={600}>Historial de notas</Text>
                </Group>
                {notes.length === 0 ? (
                <Text size='sm' c='dimmed'>Sin notas registradas</Text>
                ) : (
                <Stack gap='xs'>
                    {notes.map((n, index) => (
                    <Card
                        key={`auth-note-${n.id_note ?? 'x'}-${index}`}
                        withBorder
                        radius='md'
                        p='sm'
                    >
                        <Text size='sm' style={{ whiteSpace: 'pre-line' }}>{n.note}</Text>
                        <Group gap={6} mt={4}>
                        <Text size='xs' c='dimmed'>{n.createdBy || 'Sistema'}</Text>
                        <Text size='xs' c='dimmed'>·</Text>
                        <Text size='xs' c='dimmed'>{formatDateCO(n.creation_date)}</Text>
                        </Group>
                    </Card>
                    ))}
                </Stack>
                )}
            </div>

          </Stack>
        )}
      </Box>
    </Modal>
  );
}

