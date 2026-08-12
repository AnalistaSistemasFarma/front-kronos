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
} from '@tabler/icons-react';
import axios from 'axios';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../../../components/microsoft-365/useGetMicrosoftToken';

// Item mínimo que llega desde el panel de autorización (subconjunto de AuthorizationRequest).
interface RequestSummary {
  id_request_general: number;
  subject: string;
  company: string;
  type_authorization: string;
  requester: string;
  created_at: string;
  status: string;
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
    case 'pendiente':
      return 'yellow';
    case 'autorizado':
      return 'green';
    case 'rechazado':
      return 'red';
    case 'cancelado':
      return 'red';
    default:
      return 'gray';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pendiente':
      return 'Pendiente';
    case 'autorizado':
      return 'Autorizado';
    case 'rechazado':
      return 'Rechazado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return status;
  }
};

// Fecha en hora Colombia (ajuste +5h, igual que view-request).
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

// Formatea el valor de un campo; si el campo es un monto y el texto es numérico, aplica separador de miles.
const formatFieldValue = (label: string, value: string) => {
  if (/valor a pagar|monto/i.test(label)) {
    const n = Number(String(value).replace(/[.\s]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n.toLocaleString('es-CO');
  }
  return value;
};

export default function AuthorizationDetailModal({ opened, onClose, request }: Props) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [formValues, setFormValues] = useState<FormValue[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);

  const [files, setFiles] = useState<FolderFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const idReqGen = request?.id_request_general;

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
        const [detailRes, valuesRes, notesRes] = await Promise.all([
          fetch(`/api/requests-general/view-request?id=${idReqGen}`),
          fetch(`/api/requests-general/request-form-values?id_request=${idReqGen}`),
          fetch(`/api/requests-general/notes?id_request=${idReqGen}`),
        ]);

        const detailJson = await detailRes.json().catch(() => null);
        const valuesJson = await valuesRes.json().catch(() => []);
        const notesJson = await notesRes.json().catch(() => []);
        if (!active) return;

        if (!detailRes.ok) {
          setError(detailJson?.error || 'No se pudo cargar el detalle de la solicitud.');
        } else {
          setDetail(detailJson);
        }
        setFormValues(Array.isArray(valuesJson) ? valuesJson : []);
        setNotes(Array.isArray(notesJson) ? notesJson : []);
      } catch {
        if (active) setError('No se pudo cargar el detalle de la solicitud.');
      } finally {
        if (active) setLoading(false);
      }
    };

    // Adjuntos (Microsoft Graph): independiente, no bloquea el resto.
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

  const subject = detail?.subject_request || request?.subject || '';

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
          <Text fw={700}>Detalle de la solicitud {request ? `#${request.id_request_general}` : ''}</Text>
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
                  <Badge variant='light' color={getStatusColor(request.status)} size='lg'>
                    {getStatusLabel(request.status)}
                  </Badge>
                )}
              </Group>
              {request?.type_authorization && (
                <Badge mt={6} variant='light' color='indigo' size='sm'>
                  {request.type_authorization}
                </Badge>
              )}
            </div>

            <Divider />

            {/* Datos generales */}
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconBuilding size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Empresa</Text>
                </Group>
                <Text size='sm' fw={600}>{detail?.company || request?.company || '—'}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconUser size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Solicitante</Text>
                </Group>
                <Text size='sm' fw={600}>{detail?.requester || request?.requester || '—'}</Text>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Group gap={6} wrap='nowrap'>
                  <IconUserCheck size={16} className='text-gray-400' />
                  <Text size='xs' c='dimmed' fw={500}>Asignado</Text>
                </Group>
                <Text size='sm' fw={600}>{detail?.usuario || '—'}</Text>
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
                <Text size='sm' fw={600}>{formatDateCO(detail?.created_at || request?.created_at)}</Text>
              </Grid.Col>
            </Grid>

            {detail?.description && (
              <Card withBorder radius='md' p='sm' bg='var(--mantine-color-gray-0)'>
                <Text size='xs' c='dimmed' fw={500} mb={4}>Descripción</Text>
                <Text size='sm' style={{ whiteSpace: 'pre-line' }}>{detail.description}</Text>
              </Card>
            )}

            {/* Información de pago (campos del formulario) */}
            {formValues.length > 0 && (
              <div>
                <Group gap={6} mb='xs'>
                  <IconCashBanknote size={18} className='text-gray-500' />
                  <Text fw={600}>Información de pago</Text>
                </Group>
                <Grid>
                  {formValues.map((fv) => {
                    const raw = fv.option_label || fv.value_text || '';
                    const shown = raw ? formatFieldValue(fv.field_label, raw) : '—';
                    return (
                      <Grid.Col span={{ base: 12, sm: 6 }} key={fv.id}>
                        <Card withBorder radius='md' p='sm'>
                          <Text size='xs' c='dimmed' fw={500} tt='uppercase'>{fv.field_label}</Text>
                          <Text size='sm' fw={600} mt={2}>{shown}</Text>
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </div>
            )}

            {/* Adjuntos */}
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
                  {files.map((file) => (
                    <Card key={file.id} withBorder radius='md' p='xs'>
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

            {/* Notas / historial */}
            <div>
              <Group gap={6} mb='xs'>
                <IconNotes size={18} className='text-gray-500' />
                <Text fw={600}>Historial de notas</Text>
              </Group>
              {notes.length === 0 ? (
                <Text size='sm' c='dimmed'>Sin notas registradas</Text>
              ) : (
                <Stack gap='xs'>
                  {notes.map((n) => (
                    <Card key={n.id_note} withBorder radius='md' p='sm'>
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
