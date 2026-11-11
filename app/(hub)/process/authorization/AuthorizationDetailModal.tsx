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
  Box,
  Button,
  Table,
  ScrollArea,
  Skeleton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import PurchaseRequestDetail from '../purchases/PurchaseRequestDetail';
import SalesOfferDetail from '../sales/SalesOfferDetail';
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
  IconFileDescription,
  IconExternalLink,
} from '@tabler/icons-react';
import { ORION_SIGNATURE_FIELD_TYPE } from '../../../../lib/orion/fieldType';
import {
  isFirmaAuthorizationItem,
  isOrionReviewResolution,
  parseOrionFileIdFromAuthResolution,
  parseOrionFileNameFromResolution,
  parseOrionReviewFileId,
  parseOrionReviewFileName,
} from '../../../../lib/orion/signerAuthMarkers';
import { formatDbDateTime } from '../../../../lib/dbDate';
import {
  TABLE_FIELD_TYPE,
  parseTableConfig,
  parseTableValue,
} from '../../../../lib/requests-general/tableField';
import { formatEstimatedPaymentDate } from '../../../../lib/treasury/estimatedPaymentDate';
import {
  loadAuthorizationDetail,
  peekAuthorizationDetail,
} from '../../../../lib/authorization/detailPrefetch';

// Item mínimo que llega desde el panel de autorización (subconjunto de AuthorizationRequest).
interface RequestSummary {
  id_request_general: number;
  subject: string;
  company: string;
  type_authorization: string;
  task?: string | null;
  requester: string;
  created_at: string;
  status: string;
  resolution?: string | null;
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

// OneDrive entrega ISO en UTC real (a diferencia de las columnas de BD).
const formatUtcDateCO = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(date);
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

function isOrionSignatureFormValue(fv: FormValue): boolean {
  if (fv.field_type === ORION_SIGNATURE_FIELD_TYPE) return true;
  const raw = String(fv.value_text || '').trim();
  if (!raw.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(raw) as { documents?: unknown };
    return Boolean(parsed && typeof parsed === 'object' && parsed.documents);
  } catch {
    return false;
  }
}

/** Autorización de firma: no exponer PDFs, firmantes ni historial de progreso. */
function isFirmaAuthorizationRequest(request: RequestSummary | null): boolean {
  if (!request) return false;
  return isFirmaAuthorizationItem({
    resolution: request.resolution,
    typeAuthorization: request.type_authorization,
    taskName: request.task,
  });
}

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
  /** Solicitud de compra: la ventana se agranda para que se vean las líneas. */
  const [isPurchase, setIsPurchase] = useState(false);
  const [isSale, setIsSale] = useState(false);
  useEffect(() => setIsPurchase(false), [idReqGen]);
  const isFirmaAuth = isFirmaAuthorizationRequest(request);
  // En firma: sin adjuntos ni notas. El recorrido del documento va aparte, en el botón «Ver flujo»
  // de Acciones (DocumentFlowModal: nombres, estado y fecha; decisión de Juan del 2026-11-11).
  const hideSensitiveFirmaContext = isFirmaAuth;

  useEffect(() => {
    if (!opened || !idReqGen) return;
    let active = true;
    const withNotes = !hideSensitiveFirmaContext;
    const cached = peekAuthorizationDetail(idReqGen, withNotes);

    setError(null);
    setFiles([]);
    setFilesError(null);
    if (cached) {
      // Prefetch de Acciones: pintar al toque sin pantalla de espera.
      if (!cached.detailOk) {
        setError(cached.detailError || 'No se pudo cargar el detalle de la solicitud.');
        setDetail(null);
        setFormValues([]);
        setNotes([]);
      } else {
        setDetail((cached.detail as DetailData | null) ?? null);
        const values = Array.isArray(cached.formValues) ? (cached.formValues as FormValue[]) : [];
        setFormValues(values.filter((fv) => !isOrionSignatureFormValue(fv)));
        setNotes(withNotes && Array.isArray(cached.notes) ? (cached.notes as NoteItem[]) : []);
      }
      setLoading(false);
    } else {
      setDetail(null);
      setFormValues([]);
      setNotes([]);
      setLoading(true);
    }

    const loadData = async () => {
      try {
        const data = await loadAuthorizationDetail(idReqGen, withNotes);
        if (!active) return;
        if (!data.detailOk) {
          setError(data.detailError || 'No se pudo cargar el detalle de la solicitud.');
          setDetail(null);
        } else {
          setDetail((data.detail as DetailData | null) ?? null);
          setError(null);
        }
        const values = Array.isArray(data.formValues) ? (data.formValues as FormValue[]) : [];
        setFormValues(values.filter((fv) => !isOrionSignatureFormValue(fv)));
        setNotes(withNotes && Array.isArray(data.notes) ? (data.notes as NoteItem[]) : []);
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('No se pudo cargar el detalle de la solicitud.');
      } finally {
        if (active) setLoading(false);
      }
    };

    // Adjuntos: no se cargan en autorizaciones de firma (privacidad).
    const loadFiles = async () => {
      if (hideSensitiveFirmaContext) {
        setFilesLoading(false);
        setFiles([]);
        return;
      }
      setFilesLoading(true);
      try {
        const res = await fetch(
          `/api/requests-general/list-attachments?requestId=${encodeURIComponent(String(idReqGen))}&storagePath=SG&entityType=Request`
        );
        const data = (await res.json().catch(() => ({}))) as { files?: FolderFile[] };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!active) return;
        setFiles(Array.isArray(data.files) ? data.files : []);
      } catch {
        if (active) setFilesError('Sin adjuntos');
      } finally {
        if (active) setFilesLoading(false);
      }
    };

    void loadData();
    void loadFiles();

    return () => {
      active = false;
    };
  }, [opened, idReqGen, hideSensitiveFirmaContext]);

  const subject = detail?.subject_request || request?.subject || '';
  const firmaDocName = isFirmaAuth
    ? parseOrionFileNameFromResolution(request?.resolution)
    : null;
  const isReview = isOrionReviewResolution(request?.resolution);
  const reviewDocName = isReview ? parseOrionReviewFileName(request?.resolution) : null;
  const reviewFileId = isReview ? parseOrionReviewFileId(request?.resolution) : null;
  const reviewPdfUrl =
    reviewFileId && idReqGen
      ? `/api/requests-general/attachment-file?requestId=${idReqGen}&fileId=${encodeURIComponent(reviewFileId)}`
      : null;
  // Firma pendiente: el firmante debe poder ver el documento que va a autorizar (solo ese
  // archivo; los demás adjuntos siguen ocultos). signed-file entrega la última versión con
  // las firmas previas o, si aún no hay firmas, redirige al PDF original de la solicitud.
  // watermark/annotations=0: preview más rápida (sin sellos pdf-lib).
  const firmaFileId = isFirmaAuth ? parseOrionFileIdFromAuthResolution(request?.resolution) : null;
  const firmaPdfUrl =
    firmaFileId && idReqGen
      ? `/api/integrations/orion/signed-file?requestId=${idReqGen}&fileId=${encodeURIComponent(firmaFileId)}&watermark=0&annotations=0`
      : null;
  const previewPdfUrl = reviewPdfUrl ?? firmaPdfUrl;
  const previewDocName = reviewPdfUrl ? reviewDocName : firmaDocName;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size={isPurchase || isSale ? '90%' : 'xl'}
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
      <Box mih={120}>
        {error ? (
          <Alert color='red' icon={<IconAlertCircle size={16} />} title='Error'>
            {error}
          </Alert>
        ) : (
          <Stack gap='md'>
            {/* Encabezado: sale al toque con datos del listado (sin pantalla blanca). */}
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
              {isFirmaAuth && firmaDocName ? (
                <Alert color='violet' variant='light' mt='sm' title='Documento a firmar'>
                  <Text size='sm' fw={600} style={{ wordBreak: 'break-word' }}>
                    {firmaDocName}
                  </Text>
                </Alert>
              ) : null}
              {isReview ? (
                <Alert color='grape' variant='light' mt='sm' title='Documento a validar'>
                  {reviewDocName ? (
                    <Text size='sm' fw={600} style={{ wordBreak: 'break-word' }}>
                      {reviewDocName}
                    </Text>
                  ) : null}
                  <Text size='xs' c='dimmed' mt={4}>
                    Vista previa de solo lectura. Use Autorizar en el listado para abrir la
                    solicitud y validar o devolver el documento. La firma se habilita solo cuando
                    valida el último validador.
                  </Text>
                </Alert>
              ) : null}
            </div>

            {loading ? (
              <Stack gap='md' aria-busy aria-label='Cargando detalle de la solicitud'>
                {previewPdfUrl ? <Skeleton height={isMobile ? 220 : 280} radius='md' /> : null}
                <Grid>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Grid.Col span={{ base: 12, sm: 6 }} key={`sk-meta-${i}`}>
                      <Skeleton height={12} width='40%' mb={8} radius='sm' />
                      <Skeleton height={18} width='72%' radius='sm' />
                    </Grid.Col>
                  ))}
                </Grid>
                <Skeleton height={64} radius='md' />
                <Grid>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Grid.Col span={{ base: 12, sm: 6 }} key={`sk-card-${i}`}>
                      <Skeleton height={72} radius='md' />
                    </Grid.Col>
                  ))}
                </Grid>
                {!hideSensitiveFirmaContext ? (
                  <>
                    <Skeleton height={20} width={120} radius='sm' />
                    <Skeleton height={88} radius='md' />
                  </>
                ) : (
                  <Skeleton height={56} radius='md' />
                )}
              </Stack>
            ) : (
              <>
            {/* Compras: si esta autorización es de una solicitud de compra, se muestra con el diseño de SAPSEND. */}
            {idReqGen ? <PurchaseRequestDetail requestId={idReqGen} onLoaded={setIsPurchase} /> : null}

            {/* Ventas: oferta en SAP con cupo, % de extracupo y cartera por edades para decidir. */}
            {idReqGen ? <SalesOfferDetail requestId={idReqGen} onLoaded={setIsSale} /> : null}

            {previewPdfUrl ? (
              <Card withBorder radius='md' p={0} style={{ overflow: 'hidden' }}>
                <Group justify='space-between' px='sm' py={6} wrap='nowrap'>
                  <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
                    <IconFileDescription size={16} className='text-gray-500' />
                    <Text size='sm' fw={600} truncate>
                      {previewDocName || 'Documento'}
                    </Text>
                  </Group>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    leftSection={<IconExternalLink size={12} />}
                    component='a'
                    href={previewPdfUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Abrir en otra pestaña
                  </Button>
                </Group>
                <iframe
                  title={`Vista previa de ${previewDocName || 'documento'}`}
                  src={previewPdfUrl}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: isMobile ? '70vh' : '60vh',
                    border: 0,
                    borderTop: '1px solid var(--mantine-color-default-border)',
                  }}
                />
              </Card>
            ) : null}

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
                <Text size='sm' fw={600}>{formatDbDateTime(detail?.created_at || request?.created_at)}</Text>
              </Grid.Col>
              {detail?.process === 'Solicitud de Pago' && (
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Group gap={6} wrap='nowrap'>
                    <IconCalendarEvent size={16} className='text-gray-400' />
                    <Text size='xs' c='dimmed' fw={500}>Fecha estimada de pago</Text>
                  </Group>
                  <Text size='sm' fw={600} tt='capitalize'>
                    {formatEstimatedPaymentDate(
                      detail?.company || request?.company,
                      detail?.created_at || request?.created_at
                    )}
                  </Text>
                </Grid.Col>
              )}
            </Grid>

            {detail?.description && (
              <Card withBorder radius='md' p='sm' bg='var(--mantine-color-gray-0)'>
                <Text size='xs' c='dimmed' fw={500} mb={4}>Descripción</Text>
                <Text size='sm' style={{ whiteSpace: 'pre-line' }}>{detail.description}</Text>
              </Card>
            )}

            {/* Campos del formulario (sin payloads Orion / firmantes) */}
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

            {hideSensitiveFirmaContext ? (
              <Alert color='blue' variant='light' icon={<IconAlertCircle size={16} />}>
                Por privacidad, en esta autorización no se muestran adjuntos, firmantes ni el
                avance del proceso de firma.
                {request?.status === 'pendiente'
                  ? ' Autorice en el listado para poder firmar su parte.'
                  : ' Abra la solicitud para firmar su parte.'}
              </Alert>
            ) : (
              <>
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
                                  {formatFileSize(file.size)} · {formatUtcDateCO(file.lastModifiedDateTime)}
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
                            <Text size='xs' c='dimmed'>{formatDbDateTime(n.creation_date)}</Text>
                          </Group>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </div>
              </>
            )}
              </>
            )}
          </Stack>
        )}
      </Box>
    </Modal>
  );
}

