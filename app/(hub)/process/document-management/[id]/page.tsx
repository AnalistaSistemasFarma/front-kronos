'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Loader,
  Alert,
  Table,
  Badge,
  Group,
  Stack,
  Button,
  Paper,
  Text,
  Title,
  Anchor,
} from '@mantine/core';
import { IconArrowLeft, IconUpload } from '@tabler/icons-react';
import Link from 'next/link';
import UploadVersionModal from './UploadVersionModal';
import TransitionActions from './TransitionActions';
import { isClosedState } from '../../../../../lib/document-management/workflowStates';

interface DocumentVersionRow {
  id_document_version: number;
  version_number: number;
  status: string;
  onedrive_path: string;
  created_at: string;
  comments: string | null;
  id_request_general: number | null;
}

interface DocumentDetail {
  id_document: number;
  code: string;
  title: string;
  current_status: string;
  current_version_id: number | null;
  due_review_date: string | null;
  is_restricted: boolean;
  company: { id_company: number; company: string };
  documentType: { id_document_type: number; name: string };
  owner: { id: string; name: string | null; email: string };
  versions: DocumentVersionRow[];
}

function statusColor(status: string): string {
  if (status === 'Vigente') return 'green';
  if (isClosedState(status)) return 'red';
  if (status === 'Reasignación' || status === 'Reelaboración') return 'yellow';
  return 'blue';
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const idDocument = Number(params?.id);
  const { data: session } = useSession();

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    if (!idDocument) return;
    try {
      setLoading(true);
      setError(null);
      const [docRes, accessRes] = await Promise.all([
        fetch(`/api/document-management/documents/${idDocument}`),
        fetch('/api/document-management/access'),
      ]);
      const docData = await docRes.json();
      if (!docRes.ok) throw new Error(docData.error || 'No se pudo cargar el documento');
      setDocument(docData.document);

      if (accessRes.ok) {
        const accessData = await accessRes.json();
        const companies: Array<{ idCompany: number; canWrite: boolean }> = accessData.companies ?? [];
        const match = companies.find((c) => c.idCompany === docData.document.company.id_company);
        setCanWrite(!!match?.canWrite);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [idDocument]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error || !document) {
    return (
      <Alert color="red" title="Gestión Documental" mt="md">
        {error || 'Documento no encontrado'}
      </Alert>
    );
  }

  const currentVersion =
    document.versions.find((v) => v.id_document_version === document.current_version_id) ??
    document.versions[0] ??
    null;

  return (
    <div style={{ padding: '1rem' }}>
      <Anchor component={Link} href="/process/document-management" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Volver al listado
        </Group>
      </Anchor>

      <Group justify="space-between" align="center" mt="sm">
        <div>
          <Title order={3}>
            {document.code} — {document.title}
          </Title>
          <Text size="sm" c="dimmed">
            {document.documentType?.name} · {document.company.company} · Dueño: {document.owner.name || document.owner.email}
          </Text>
        </div>
        <Group gap="xs">
          <Badge color={statusColor(document.current_status)} size="lg">
            {document.current_status}
          </Badge>
          {canWrite && (
            <Button leftSection={<IconUpload size={16} />} onClick={() => setUploadOpen(true)}>
              Subir nueva versión
            </Button>
          )}
        </Group>
      </Group>

      <UploadVersionModal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        idDocument={document.id_document}
        onCreated={load}
      />

      {currentVersion && (
        <Paper withBorder p="md" mt="md">
          <Text fw={600} mb="xs">
            Tarea pendiente — versión {currentVersion.version_number} ({currentVersion.status})
          </Text>
          <TransitionActions
            idDocument={document.id_document}
            idDocumentVersion={currentVersion.id_document_version}
            state={currentVersion.status}
            canWrite={canWrite}
            onDone={load}
          />
        </Paper>
      )}

      <Text fw={600} mt="lg" mb="xs">
        Historial de versiones
      </Text>
      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Versión</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Cargada</Table.Th>
              <Table.Th>Ruta OneDrive</Table.Th>
              <Table.Th>Comentario</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {document.versions.map((v) => (
              <Table.Tr key={v.id_document_version}>
                <Table.Td>v{v.version_number}</Table.Td>
                <Table.Td>
                  <Badge color={statusColor(v.status)} variant="light">
                    {v.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{v.created_at?.slice(0, 10)}</Table.Td>
                <Table.Td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.onedrive_path}
                </Table.Td>
                <Table.Td>{v.comments || '-'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}
