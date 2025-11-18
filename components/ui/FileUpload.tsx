'use client';

import React, { useState, useRef, useCallback } from 'react';
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

export interface UploadedFile {
  id: string;
  file: File;
  status: 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  url?: string;
}

interface FileUploadProps {
  ticketId: number;
  onFilesChange?: (files: UploadedFile[]) => void;
  maxFiles?: number;
  disabled?: boolean;
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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const FileUpload: React.FC<FileUploadProps> = ({
  ticketId,
  onFilesChange,
  maxFiles = 10,
  disabled = false,
}) => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (file.size > MAX_FILE_SIZE) {
      return `El archivo es demasiado grande. Tamaño máximo: 10MB`;
    }
    return null;
  };

  const uploadFile = async (file: File, fileId: string) => {
    try {
      const token = await getMicrosoftToken();
      if (!token) {
        throw new Error('No se pudo obtener el token de acceso');
      }

      // Crear carpeta única con el ID del ticket
      const folderName = `Ticket-${ticketId}`;

      // Preparar archivo para subida
      const filesToUpload = [{ file }];

      // Actualizar estado a uploading
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: 'uploading', progress: 0 } : f))
      );

      // Simular progreso durante la carga
      const progressInterval = setInterval(() => {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId && f.status === 'uploading'
              ? { ...f, progress: Math.min(f.progress + 10, 90) }
              : f
          )
        );
      }, 200);

      // Usar la nueva función CheckOrCreateFolderAndUpload
      await CheckOrCreateFolderAndUpload(folderName, filesToUpload, token);

      clearInterval(progressInterval);

      // Actualizar estado a success
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: 'success', progress: 100 } : f))
      );
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
    }
  };

  const CheckOrCreateFolderAndUpload = async (
    folderName: string,
    files: { file: File }[],
    token: string
  ) => {
    try {
      let folderId: string;

      // Intentar obtener la carpeta existente
      const getResponse = await fetch(
        `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/MA/${folderName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (getResponse.ok) {
        // Carpeta existe, obtener su ID
        const folderData = await getResponse.json();
        folderId = folderData.id;
      } else if (getResponse.status === 404) {
        // Carpeta no existe, crearla
        const createResponse = await fetch(
          `${process.env.MICROSOFTGRAPHUSERROUTE}root:/SAPSEND/TEC/MA:/children`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: folderName,
              folder: {},
            }),
          }
        );

        if (!createResponse.ok) {
          throw new Error('Error creando la carpeta.');
        }

        const folderData = await createResponse.json();
        folderId = folderData.id;
      } else {
        throw new Error('Error al verificar la existencia de la carpeta.');
      }

      // Subir archivos a la carpeta
      if (files && files.length > 0) {
        const uploadPromises = files.map(async (fileWrapper) => {
          const response = await fetch(
            `${process.env.MICROSOFTGRAPHUSERROUTE}items/${folderId}:/${fileWrapper.file.name}:/content`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': fileWrapper.file.type,
              },
              body: fileWrapper.file,
            }
          );

          if (!response.ok) {
            throw new Error(`Error al subir el archivo: ${fileWrapper.file.name}`);
          }

          return response;
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
        status: 'uploading' as const,
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...uploadedFiles]);

      // Subir archivos
      for (const uploadedFile of uploadedFiles) {
        await uploadFile(uploadedFile.file, uploadedFile.id);
      }

      // Notificar cambios
      if (onFilesChange) {
        setFiles((currentFiles) => {
          onFilesChange(currentFiles);
          return currentFiles;
        });
      }
    },
    [files.length, maxFiles, disabled, onFilesChange]
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

  const removeFile = useCallback(
    (fileId: string) => {
      setFiles((prev) => {
        const newFiles = prev.filter((f) => f.id !== fileId);
        if (onFilesChange) {
          onFilesChange(newFiles);
        }
        return newFiles;
      });
    },
    [onFilesChange]
  );

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
              Tipos permitidos: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG (máx. 10MB cada uno)
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
            Archivos adjuntos ({files.length}/{maxFiles})
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
