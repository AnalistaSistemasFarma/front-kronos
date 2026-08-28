'use client';

import React, { useState } from 'react';
import {
  Modal,
  Select,
  TextInput,
  Textarea,
  Button,
  Group,
  Stack,
  Alert,
  Checkbox,
  FileInput,
  Divider,
  Anchor,
} from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';

interface WritableCompany {
  idCompany: number;
  companyName: string;
}

interface DocumentType {
  id_document_type: number;
  name: string;
  code_prefix: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  companies: WritableCompany[];
  types: DocumentType[];
  onCreated: () => void;
}

export default function CreateDocumentModal({ opened, onClose, companies, types, onCreated }: Props) {
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0] ? String(companies[0].idCompany) : null
  );
  const [documentTypeId, setDocumentTypeId] = useState<string | null>(
    types[0] ? String(types[0].id_document_type) : null
  );
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [dueReviewDate, setDueReviewDate] = useState('');
  const [isRestricted, setIsRestricted] = useState(false);
  const [comments, setComments] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [showNewType, setShowNewType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypePrefix, setNewTypePrefix] = useState('');
  const [creatingType, setCreatingType] = useState(false);
  const [localTypes, setLocalTypes] = useState<DocumentType[]>(types);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setTitle('');
    setDueReviewDate('');
    setIsRestricted(false);
    setComments('');
    setFile(null);
    setError(null);
    setShowNewType(false);
    setNewTypeName('');
    setNewTypePrefix('');
  };

  const createType = async () => {
    setError(null);
    if (!newTypeName.trim() || !newTypePrefix.trim()) {
      setError('Nombre y prefijo del tipo son obligatorios');
      return;
    }
    setCreatingType(true);
    try {
      const res = await fetch('/api/document-management/types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTypeName.trim(), codePrefix: newTypePrefix.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo crear el tipo de documento');
        return;
      }
      setLocalTypes((prev) => [...prev, data.type]);
      setDocumentTypeId(String(data.type.id_document_type));
      setShowNewType(false);
      setNewTypeName('');
      setNewTypePrefix('');
    } catch {
      setError('Error de red al crear el tipo de documento');
    } finally {
      setCreatingType(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!companyId) return setError('Seleccione una empresa');
    if (!documentTypeId) return setError('Seleccione un tipo de documento');
    if (!code.trim()) return setError('El código es obligatorio');
    if (!title.trim()) return setError('El título es obligatorio');
    if (!file) return setError('Seleccione el archivo a cargar');

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('companyId', companyId);
      formData.append('documentTypeId', documentTypeId);
      formData.append('code', code.trim());
      formData.append('title', title.trim());
      if (dueReviewDate) formData.append('dueReviewDate', dueReviewDate);
      formData.append('isRestricted', String(isRestricted));
      if (comments.trim()) formData.append('comments', comments.trim());
      formData.append('file', file);

      const res = await fetch('/api/document-management/documents', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo crear el documento');
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch {
      setError('Error de red al crear el documento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Cargar documento (carga inicial)" size="lg">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}

        <Select
          label="Empresa"
          required
          data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
          value={companyId}
          onChange={setCompanyId}
          allowDeselect={false}
        />

        <Select
          label="Tipo de documento"
          required
          data={localTypes.map((t) => ({
            value: String(t.id_document_type),
            label: `${t.name} (${t.code_prefix})`,
          }))}
          value={documentTypeId}
          onChange={setDocumentTypeId}
          placeholder={localTypes.length === 0 ? 'No hay tipos creados aún' : undefined}
        />
        <Anchor size="xs" onClick={() => setShowNewType((v) => !v)}>
          {showNewType ? 'Cancelar nuevo tipo' : '+ Crear tipo de documento nuevo'}
        </Anchor>

        {showNewType && (
          <Group gap="xs" align="flex-end" wrap="wrap">
            <TextInput
              label="Nombre del tipo"
              placeholder="Procedimiento"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.currentTarget.value)}
              style={{ flex: '1 1 200px' }}
            />
            <TextInput
              label="Prefijo"
              placeholder="PRO"
              value={newTypePrefix}
              onChange={(e) => setNewTypePrefix(e.currentTarget.value.toUpperCase())}
              style={{ flex: '0 1 120px' }}
            />
            <Button size="sm" onClick={createType} loading={creatingType}>
              Crear tipo
            </Button>
          </Group>
        )}

        <Divider />

        <TextInput
          label="Código del documento"
          required
          placeholder="POL-GH-001"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
        />
        <TextInput
          label="Título"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <TextInput
          label="Próxima fecha de revisión"
          type="date"
          value={dueReviewDate}
          onChange={(e) => setDueReviewDate(e.currentTarget.value)}
        />
        <Checkbox
          label="Documento restringido (acceso confidencial)"
          checked={isRestricted}
          onChange={(e) => setIsRestricted(e.currentTarget.checked)}
        />
        <FileInput
          label="Archivo (versión vigente)"
          placeholder="Seleccione el archivo"
          required
          value={file}
          onChange={setFile}
          leftSection={<IconUpload size={16} />}
        />
        <Textarea
          label="Comentario (queda en la versión)"
          value={comments}
          onChange={(e) => setComments(e.currentTarget.value)}
          minRows={2}
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Cargar documento
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
