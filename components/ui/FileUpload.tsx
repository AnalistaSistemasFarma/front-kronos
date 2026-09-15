'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Group,
  Button,
  Text,
  Stack,
  Card,
  Progress,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Flex,
} from '@mantine/core';
import {
  IconX,
  IconFile,
  IconFileText,
  IconFileSpreadsheet,
  IconPhoto,
  IconAlertCircle,
  IconCheck,
  IconCloudUpload,
} from '@tabler/icons-react';
import { useGetMicrosoftToken as getMicrosoftToken } from '../microsoft-365/useGetMicrosoftToken';
import { sanitizeOneDriveName } from '../../lib/onedriveName';
import { ensureOneDriveFolderPath, uploadFileToOneDriveFolder } from '../../lib/onedrive/graphFolderUpload';

export interface UploadedFile {
  id: string;
  file: File;
  status: 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  url?: string;
  /** Item OneDrive devuelto por el API de subida (si aplica). */
  graphItem?: {
    id: string;
    name: string;
    size?: number;
    webUrl?: string;
    lastModifiedDateTime?: string;
    '@microsoft.graph.downloadUrl'?: string;
  };
}

interface FileUploadProps {
  ticketId: number;
  onFilesChange?: (files: UploadedFile[]) => void;
  /** Se llama tras cada archivo subido con éxito (para refrescar la tabla de adjuntos). */
  onUploadComplete?: (file: UploadedFile) => void;
  maxFiles?: number;
  disabled?: boolean;
  storagePath?: string;
  entityType?: string;
  autoUpload?: boolean;
  /**
   * Si true (default), sube vía API servidor → OneDrive (más fiable).
   * Si false, usa Graph directo desde el navegador (legado).
   */
  useServerUpload?: boolean;
}

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/jpg',
];

const MAX_FILE_SIZE = Number.MAX_SAFE_INTEGER; // Sin límite de tamaño

const FileUpload: React.FC<FileUploadProps> = ({
  ticketId,
  onFilesChange,
  onUploadComplete,
  maxFiles = Number.MAX_SAFE_INTEGER, // Sin límite de archivos
  disabled = false,
  storagePath = 'MA',
  entityType = 'Ticket',
  autoUpload = true,
  useServerUpload = true,
}) => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFilesChangeRef = useRef(onFilesChange);
  const onUploadCompleteRef = useRef(onUploadComplete);

  useEffect(() => {
    onFilesChangeRef.current = onFilesChange;
  }, [onFilesChange]);

  useEffect(() => {
    onUploadCompleteRef.current = onUploadComplete;
  }, [onUploadComplete]);

  useEffect(() => {
    onFilesChangeRef.current?.(files);
  }, [files]);

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <IconFileText size={20} />;
    if (type.includes('word') || type.includes('document')) return <IconFileText size={20} />;
    if (type.includes('excel') || type.includes('spreadsheet'))
      return <IconFileSpreadsheet size={20} />;
    if (type.includes('image')) return <IconPhoto size={20} />;
    return <IconFile size={20} />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Tipo de archivo no permitido. Solo se permiten: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG`;
    }
    // Sin límite de tamaño de archivo
    return null;
  };

  const uploadFile = async (file: File, fileId: string) => {
    const progressInterval = setInterval(() => {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId && f.status === 'uploading'
            ? { ...f, progress: Math.min(f.progress + 10, 90) }
            : f
        )
      );
    }, 200);

    try {
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: 'uploading', progress: 0 } : f))
      );

      let graphItem: UploadedFile['graphItem'];

      if (useServerUpload) {
        const form = new FormData();
        form.append('requestId', String(ticketId));
        form.append('storagePath', storagePath);
        form.append('entityType', entityType);
        form.append('files', file, file.name);

        const res = await fetch('/api/requests-general/upload-attachments', {
          method: 'POST',
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          uploaded?: UploadedFile['graphItem'][];
        };
        if (!res.ok) {
          throw new Error(data.error || `Error al subir el archivo (HTTP ${res.status})`);
        }
        graphItem = data.uploaded?.[0];
        if (!graphItem?.id) {
          throw new Error(data.error || 'El servidor no confirmó el archivo en OneDrive');
        }
      } else {
        const token = await getMicrosoftToken();
        if (!token) {
          throw new Error('No se pudo obtener el token de acceso');
        }
        const folderName = `${entityType}-${ticketId}`;
        await CheckOrCreateFolderAndUpload(folderName, [{ file }], token, storagePath);
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: 'success' as const, progress: 100, graphItem }
            : f
        )
      );
      const completed: UploadedFile = {
        id: fileId,
        file,
        status: 'success',
        progress: 100,
        graphItem,
      };
      queueMicrotask(() => {
        onUploadCompleteRef.current?.(completed);
        // Limpiar de la cola de subida tras éxito: la tabla de adjuntos es la fuente de verdad.
        window.setTimeout(() => {
          setFiles((prev) => prev.filter((f) => f.id !== fileId || f.status !== 'success'));
        }, 1200);
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                status: 'error',
                error:
                  error instanceof Error ? error.message : 'Error desconocido al subir el archivo',
              }
            : f
        )
      );
    } finally {
      clearInterval(progressInterval);
    }
  };

  // Ruta base histórica de este componente (tickets de SAPSEND). La lógica de
  // "obtener o crear carpeta anidada + subir archivo" ahora vive en
  // lib/onedrive/graphFolderUpload.ts (genérica, por segmentos de ruta), para
  // que otros módulos (p.ej. Gestión Documental) puedan reusarla sin duplicar
  // las llamadas a Graph. El comportamiento para este componente no cambia:
  // sigue subiendo a SAPSEND/TEC/<storagePath>/<folderName>.
  const CheckOrCreateFolderAndUpload = async (
    folderName: string,
    files: { file: File }[],
    token: string,
    storagePath: string
  ) => {
    try {
      const folderId = await ensureOneDriveFolderPath(token, ['SAPSEND', 'TEC', storagePath, folderName]);

      // Subir archivos a la carpeta
      if (files && files.length > 0) {
        const uploadPromises = files.map((fileWrapper) => {
          const uploadName = sanitizeOneDriveName(fileWrapper.file.name);
          return uploadFileToOneDriveFolder(
            token,
            folderId,
            uploadName,
            fileWrapper.file,
            fileWrapper.file.type
          );
        });

        await Promise.all(uploadPromises);
      }
    } catch (error) {
      console.error('Error en la operación:', error);
      throw error;
    }
  };

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || disabled) return;

      const newFiles: File[] = Array.from(fileList);
      const validFiles: File[] = [];
      const errors: string[] = [];

      // Validar archivos
      for (const file of newFiles) {
        const validationError = validateFile(file);
        if (validationError) {
          errors.push(`${file.name}: ${validationError}`);
        } else {
          validFiles.push(file);
        }
      }

      // Verificar límite de archivos
      if (files.length + validFiles.length > maxFiles) {
        errors.push(`No se pueden subir más de ${maxFiles} archivos`);
        validFiles.splice(maxFiles - files.length);
      }

      // Mostrar errores si los hay
      if (errors.length > 0) {
        setError(errors.join('\n'));
      } else {
        setError(null);
      }

      // Agregar archivos válidos
      const uploadedFiles: UploadedFile[] = validFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        status: autoUpload ? 'uploading' : 'success', // Si no autoUpload, marcar como success para que se muestre
        progress: autoUpload ? 0 : 100,
      }));

      setFiles((prev) => [...prev, ...uploadedFiles]);

      // Subir archivos solo si autoUpload
      if (autoUpload) {
        for (const uploadedFile of uploadedFiles) {
          await uploadFile(uploadedFile.file, uploadedFile.id);
        }
      }
    },
    [files.length, maxFiles, disabled, autoUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Limpiar input para permitir seleccionar el mismo archivo nuevamente
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFiles]
  );

  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const retryUpload = useCallback(
    async (fileId: string) => {
      const fileToRetry = files.find((f) => f.id === fileId);
      if (fileToRetry) {
        await uploadFile(fileToRetry.file, fileId);
      }
    },
    [files]
  );

  return (
    <Stack gap='md'>
      {/* Área de drop */}
      <Card
        withBorder
        style={{
          border: isDragOver ? '2px dashed #228be6' : '2px dashed #ced4da',
          backgroundColor: isDragOver ? '#e7f5ff' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={disabled ? undefined : handleFileSelect}
        p='xl'
      >
        <Stack align='center' gap='md'>
          <IconCloudUpload
            size={48}
            color={isDragOver ? '#228be6' : '#868e96'}
            style={{ opacity: disabled ? 0.5 : 1 }}
          />
          <Stack align='center' gap='xs'>
            <Text size='lg' fw={500} c={disabled ? 'dimmed' : 'dark'}>
              {isDragOver ? 'Suelta los archivos aquí' : 'Arrastra y suelta archivos aquí'}
            </Text>
            <Text size='sm' c='dimmed'>
              o{' '}
              <Text
                component='span'
                c='blue'
                style={{
                  textDecoration: 'underline',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                selecciona archivos
              </Text>
            </Text>
            <Text size='xs' c='dimmed'>
              Tipos permitidos: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG (sin límite de tamaño)
            </Text>
          </Stack>
        </Stack>

        <input
          ref={fileInputRef}
          type='file'
          multiple
          accept='.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          disabled={disabled}
          aria-label='Seleccionar archivos para subir'
        />
      </Card>

      {/* Mensaje de error */}
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title='Error'
          color='red'
          withCloseButton
          onClose={() => setError(null)}
        >
          <Text style={{ whiteSpace: 'pre-line' }}>{error}</Text>
        </Alert>
      )}

      {/* Lista de archivos */}
      {files.length > 0 && (
        <Stack gap='sm'>
          <Text size='sm' fw={500}>
            Archivos en cola ({files.length}
            {Number.isFinite(maxFiles) ? `/${maxFiles}` : ''})
          </Text>

          {files.map((uploadedFile) => (
            <Card key={uploadedFile.id} withBorder p='sm'>
              <Flex align='center' gap='sm'>
                <Box c={uploadedFile.status === 'error' ? 'red' : 'blue'}>
                  {getFileIcon(uploadedFile.file.type)}
                </Box>

                <Box style={{ flex: 1 }}>
                  <Text size='sm' fw={500} lineClamp={1}>
                    {uploadedFile.file.name}
                  </Text>
                  <Text size='xs' c='dimmed'>
                    {formatFileSize(uploadedFile.file.size)}
                  </Text>

                  {uploadedFile.status === 'uploading' && (
                    <Progress value={uploadedFile.progress} size='sm' mt='xs' color='blue' />
                  )}

                  {uploadedFile.status === 'error' && uploadedFile.error && (
                    <Text size='xs' c='red' mt='xs'>
                      {uploadedFile.error}
                    </Text>
                  )}
                </Box>

                <Group gap='xs'>
                  {uploadedFile.status === 'success' && (
                    <Badge color='green' size='sm' leftSection={<IconCheck size={12} />}>
                      Subido
                    </Badge>
                  )}

                  {uploadedFile.status === 'error' && (
                    <Button
                      size='xs'
                      variant='light'
                      color='blue'
                      onClick={() => retryUpload(uploadedFile.id)}
                    >
                      Reintentar
                    </Button>
                  )}

                  <ActionIcon
                    variant='subtle'
                    color='red'
                    size='sm'
                    onClick={() => removeFile(uploadedFile.id)}
                    aria-label={`Eliminar archivo ${uploadedFile.file.name}`}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
              </Flex>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default FileUpload;
