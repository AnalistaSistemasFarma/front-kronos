'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Loader,
  Alert,
  Table,
  TextInput,
  Select,
  Badge,
  Group,
  Button,
  Anchor,
} from '@mantine/core';
import { IconSearch, IconPlus, IconListCheck } from '@tabler/icons-react';
import Link from 'next/link';
import CreateDocumentModal from './CreateDocumentModal';
import { isClosedState } from '../../../../lib/document-management/workflowStates';

/**
 * Gestión Documental — listado de documentos (Fase 1: carga inicial directo
 * en "Vigente"; Fase 2: agrega el flujo de aprobación de 14 estados, ver
 * /process/document-management/[id] y /process/document-management/mis-tareas).
 *
 * Consolida los documentos de TODAS las empresas a las que el usuario tiene
 * acceso de lectura, con el mismo patrón multiempresa de Registros
 * Sanitarios: dos endpoints propios (/api/document-management/access y
 * /api/document-management/documents) que resuelven el permiso en el
 * servidor.
 */

function statusColor(status: string): string {
  if (status === 'Vigente') return 'green';
  if (isClosedState(status)) return 'red';
  if (status === 'Reasignación' || status === 'Reelaboración') return 'yellow';
  return 'blue';
}

interface CompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
}

interface DocumentVersionSummary {
  id_document_version: number;
  version_number: number;
  status: string;
  onedrive_path: string;
  created_at: string;
}

interface DocumentRow {
  id_document: number;
  code: string;
  title: string;
  current_status: string;
  due_review_date: string | null;
  is_restricted: boolean;
  updated_at: string;
  company: { id_company: number; company: string };
  documentType: { id_document_type: number; name: string };
  owner: { id: string; name: string | null; email: string };
  versions: DocumentVersionSummary[];
}

interface DocumentType {
  id_document_type: number;
  name: string;
  code_prefix: string;
}

export default function DocumentManagementPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [companies, setCompanies] = useState<CompanyAccess[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [accessRes, typesRes] = await Promise.all([
        fetch('/api/document-management/access'),
        fetch('/api/document-management/types'),
      ]);
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al módulo');
      const accessData = await accessRes.json();
      const userCompanies: CompanyAccess[] = accessData.companies ?? [];
      setCompanies(userCompanies);

      if (typesRes.ok) {
        const typesData = await typesRes.json();
        setTypes(typesData.types ?? []);
      }

      if (userCompanies.length === 0) {
        setError('No tiene acceso a Gestión Documental en ninguna empresa.');
        return;
      }

      const listRes = await fetch('/api/document-management/documents');
      if (!listRes.ok) throw new Error('No se pudieron cargar los documentos');
      const listData = await listRes.json();
      setDocuments(listData.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return documents.filter((d) => {
      if (selectedCompany !== 'all' && String(d.company.id_company) !== selectedCompany) return false;
      if (!term) return true;
      return [d.code, d.title, d.documentType?.name].filter(Boolean).some((v) =>
        String(v).toLowerCase().includes(term)
      );
    });
  }, [documents, searchTerm, selectedCompany]);

  const companyOptions = [
    { value: 'all', label: 'Todas las empresas' },
    ...companies.map((c) => ({ value: String(c.idCompany), label: c.companyName })),
  ];

  const writable = companies
    .filter((c) => c.canWrite)
    .map((c) => ({ idCompany: c.idCompany, companyName: c.companyName }));

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Gestión Documental" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <Group justify="space-between" align="center">
        <h2 style={{ margin: 0 }}>Gestión Documental — Documentos</h2>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconListCheck size={16} />}
            component={Link}
            href="/process/document-management/mis-tareas"
          >
            Mis tareas
          </Button>
          {writable.length > 0 && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
              Cargar documento
            </Button>
          )}
        </Group>
      </Group>

      <CreateDocumentModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        companies={writable}
        types={types}
        onCreated={loadData}
      />

      <Group mt="md" mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar por código, título o tipo"
          leftSection={<IconSearch size={16} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          style={{ flex: '1 1 240px' }}
        />
        <Select
          data={companyOptions}
          value={selectedCompany}
          onChange={(v) => setSelectedCompany(v ?? 'all')}
          allowDeselect={false}
          style={{ flex: '0 1 220px', minWidth: 180 }}
        />
      </Group>

      <Table.ScrollContainer minWidth={780}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Código</Table.Th>
              <Table.Th>Título</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Versión</Table.Th>
              <Table.Th>Próxima revisión</Table.Th>
              <Table.Th>Restringido</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={8} style={{ textAlign: 'center' }}>
                  Sin documentos para mostrar.
                </Table.Td>
              </Table.Tr>
            ) : (
              filtered.map((d) => (
                <Table.Tr
                  key={d.id_document}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/process/document-management/${d.id_document}`)}
                >
                  <Table.Td>
                    <Badge variant="light">{d.company.company}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} href={`/process/document-management/${d.id_document}`} size="sm">
                      {d.code}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{d.title}</Table.Td>
                  <Table.Td>{d.documentType?.name ?? '-'}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(d.current_status)} variant="light">
                      {d.current_status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>v{d.versions[0]?.version_number ?? '-'}</Table.Td>
                  <Table.Td>{d.due_review_date?.slice(0, 10) ?? '-'}</Table.Td>
                  <Table.Td>{d.is_restricted ? 'Sí' : 'No'}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="space-between" mt="md">
        <span style={{ fontSize: 13, color: '#666' }}>
          {filtered.length} documento(s) — {companies.length} empresa(s) con acceso
        </span>
      </Group>
    </div>
  );
}
