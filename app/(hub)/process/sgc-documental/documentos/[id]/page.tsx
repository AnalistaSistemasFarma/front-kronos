'use client';

import React, { use, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import SgcSelect from '../../../../../../components/sgc/SgcSelect';
import { IconAlertTriangle, IconArrowLeft, IconBan, IconCheck, IconEdit, IconEye, IconFilePlus, IconKey } from '@tabler/icons-react';
import SgcShell from '../../../../../../components/sgc/SgcShell';
import SgcSecureViewer from '../../../../../../components/sgc/SgcSecureViewer';
import SgcDocumentRelations from '../../../../../../components/sgc/relations/SgcDocumentRelations';
import { SgcDocumentAlertsCard } from '../../../../../../components/sgc/vencimientos/SgcAlertsAdmin';
import { SgcDocumentAuditCard, SgcVerifyVersionButton } from '../../../../../../components/sgc/signature/SgcDocumentAudit';
import { SgcConfidentialityBadge, SgcDocumentCode, SgcReviewBadge, SgcStatusBadge } from '../../../../../../components/sgc/SgcBadges';
import { sgcHref } from '../../../../../../components/sgc/useSgcCompany';
import { sgcSend, useSgcFetch } from '../../../../../../components/sgc/useSgcFetch';
import { SGC_BASE_URL, SGC_CONFIDENTIALITY_LABELS, SGC_CONFIDENTIALITY_LEVELS } from '../../../../../../lib/sgc/constants';
import type { SgcCatalogs } from '../../../../../../lib/sgc/db/catalogs';
import type { SgcDocumentDetail } from '../../../../../../lib/sgc/db/documents';
import type { SgcCompanyAccess } from '../../../../../../lib/sgc/permissions';

/**
 * FICHA del documento del SGC: metadatos, código y versión, historial de
 * versiones y VISOR seguro. Aseguramiento de Calidad además edita metadatos
 * (con motivo), administra accesos por departamento o persona (incluidos los
 * permisos excepcionales de descarga/impresión, con vencimiento) y anula.
 */

type Feedback = { color: 'green' | 'red'; text: string } | null;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {label}
      </Text>
      <div>{children}</div>
    </div>
  );
}

function Ficha({ company, id }: { company: SgcCompanyAccess; id: string }) {
  const detail = useSgcFetch<SgcDocumentDetail>(`/api/sgc/documents/${id}`);
  const catalogs = useSgcFetch<SgcCatalogs>(company.canQuality ? `/api/sgc/catalogs?company=${company.idCompany}` : null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modal, setModal] = useState<'editar' | 'anular' | 'acceso' | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Formularios
  const [title, setTitle] = useState('');
  const [conf, setConf] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [grantDept, setGrantDept] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantView, setGrantView] = useState(true);
  const [grantDownload, setGrantDownload] = useState(false);
  const [grantPrint, setGrantPrint] = useState(false);
  const [grantExpires, setGrantExpires] = useState('');

  if (detail.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Documento' data-testid='sgc-ficha-error'>
        {detail.error}
      </Alert>
    );
  }
  if (!detail.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }

  const { document: d, versions, permissions, accesses } = detail.data;
  const departments = catalogs.data?.departments ?? [];
  const deptName = (idDept: number | null) => departments.find((x) => x.id === idDept)?.name ?? (idDept ? `#${idDept}` : '—');
  const current = versions.find((v) => v.isCurrent) ?? null;
  const viewing = versions.find((v) => v.id === viewVersion) ?? null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      setFeedback({ color: 'green', text: ok });
      setModal(null);
      setRevokeId(null);
      setReason('');
      detail.reload();
    } catch (e) {
      setFeedback({ color: 'red', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap='lg'>
      {feedback && (
        <Alert color={feedback.color} icon={feedback.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />} withCloseButton onClose={() => setFeedback(null)} data-testid='sgc-feedback'>
          {feedback.text}
        </Alert>
      )}

      <Card withBorder radius='md' p='lg' shadow='xs'>
        <Group justify='space-between' align='flex-start' wrap='wrap' gap='md'>
          <Stack gap={6}>
            <SgcDocumentCode code={d.code} versionNumber={d.versionNumber} />
            <Title order={2} data-testid='sgc-ficha-titulo'>
              {d.title}
            </Title>
            <Group gap={6}>
              <SgcStatusBadge status={d.status} />
              <SgcConfidentialityBadge value={d.confidentiality} />
              <SgcReviewBadge reviewDueDate={d.reviewDueDate} alertMonths={d.documentType.alertMonths} />
            </Group>
          </Stack>
          <Group gap='xs'>
            <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/listado`, company.idCompany)} variant='default' leftSection={<IconArrowLeft size={16} />}>
              Listado maestro
            </Button>
            {current && (
              <Button leftSection={<IconEye size={16} />} onClick={() => setViewVersion(current.id)} data-testid='sgc-abrir-visor'>
                Abrir en visor
              </Button>
            )}
            {d.status === 'vigente' && (company.canManage || company.canQuality) && (
              <Button
                component={Link}
                href={sgcHref(`${SGC_BASE_URL}/solicitudes/nueva`, company.idCompany, { tipo: 'nueva_version', documento: String(d.idDocument) })}
                variant='light'
                leftSection={<IconFilePlus size={16} />}
                data-testid='sgc-ficha-nueva-version'
              >
                Solicitar nueva versión
              </Button>
            )}
            {permissions.canAdminister && d.status !== 'anulado' && (
              <>
                <Button
                  variant='light'
                  leftSection={<IconEdit size={16} />}
                  onClick={() => {
                    setTitle(d.title);
                    setConf(d.confidentiality);
                    setOwner(d.idOwnerDepartment ? String(d.idOwnerDepartment) : null);
                    setReason('');
                    setModal('editar');
                  }}
                >
                  Editar
                </Button>
                <Button variant='light' color='red' leftSection={<IconBan size={16} />} onClick={() => { setReason(''); setModal('anular'); }}>
                  Anular
                </Button>
              </>
            )}
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} mt='lg' spacing='md'>
          <Field label='Tipo documental'>
            <Text size='sm'>
              {d.documentType.code} · {d.documentType.name}
            </Text>
          </Field>
          <Field label='Tipo de proceso'>
            <Badge color={d.processType.color} variant='light'>
              {d.processType.name}
            </Badge>
          </Field>
          <Field label='Proceso'>
            <Text size='sm'>
              {d.process.code} · {d.process.name}
            </Text>
          </Field>
          <Field label='Departamento dueño'>
            <Text size='sm'>{d.ownerDepartment ?? '—'}</Text>
          </Field>
          <Field label='Vigente desde'>
            <Text size='sm'>{d.effectiveDate ?? '—'}</Text>
          </Field>
          <Field label='Próxima revisión'>
            <Text size='sm'>
              {d.reviewDueDate ?? '—'} (cada {d.reviewMonths} meses)
            </Text>
          </Field>
          <Field label='Capacitación'>
            <Text size='sm'>{d.requiresTraining ? 'Obligatoria' : 'No aplica'}</Text>
          </Field>
          <Field label='Registrado por'>
            <Text size='sm'>
              {d.createdBy} · {d.createdAt.slice(0, 10)}
            </Text>
          </Field>
        </SimpleGrid>
        {d.status === 'anulado' && (
          <Alert color='red' mt='md' icon={<IconBan size={18} />} title='Documento anulado'>
            {d.annulReason} — {d.annulledBy} ({d.annulledAt?.slice(0, 10)})
          </Alert>
        )}
      </Card>

      {viewing && (
        <Card withBorder radius='md' p='lg' shadow='xs'>
          <Group justify='space-between' mb='sm'>
            <Text fw={600}>
              {d.code} V{viewing.versionNumber} · {d.title}
            </Text>
            <Button size='xs' variant='subtle' onClick={() => setViewVersion(null)}>
              Cerrar visor
            </Button>
          </Group>
          <SgcSecureViewer
            key={viewing.id}
            fileUrl={`/api/sgc/documents/${d.idDocument}/versions/${viewing.id}/file`}
            canDownload={permissions.canDownload && viewing.isCurrent}
            canPrint={permissions.canPrint && viewing.isCurrent}
          />
        </Card>
      )}

      <Card withBorder radius='md' p='lg' shadow='xs'>
        <Title order={4} mb='sm'>
          Historial de versiones
        </Title>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing='xs' data-testid='sgc-versiones'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Versión</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Vigencia</Table.Th>
                <Table.Th>Descripción del cambio</Table.Th>
                <Table.Th>Huella SHA-256</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {versions.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td>
                    <Text fw={700} ff='monospace' size='sm'>
                      V{v.versionNumber}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <SgcStatusBadge status={v.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>
                      {v.effectiveDate ?? '—'}
                      {v.obsoleteDate ? ` → ${v.obsoleteDate}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{v.changeDescription ?? '—'}</Text>
                    {v.storagePath && (
                      <Text size='xs' c='dimmed' ff='monospace'>
                        {v.storagePath}
                        {v.sourceFileName ? ` (+ fuente ${v.sourceFileName})` : ''}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs' ff='monospace' c='dimmed' title={v.pdfSha256}>
                      {v.pdfSha256.slice(0, 16)}…
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap='nowrap'>
                      <Button size='xs' variant='subtle' onClick={() => setViewVersion(v.id)}>
                        Ver
                      </Button>
                      <SgcVerifyVersionButton idDocument={d.idDocument} idVersion={v.id} />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <SgcDocumentRelations idDocument={d.idDocument} idCompany={company.idCompany} code={d.code} canAdminister={permissions.canAdminister && company.canQuality && d.status !== 'anulado'} />

      {permissions.canAdminister && company.canQuality && <SgcDocumentAlertsCard idDocument={d.idDocument} idCompany={company.idCompany} />}

      {permissions.canAdminister && company.canQuality && <SgcDocumentAuditCard idDocument={d.idDocument} />}

      {permissions.canAdminister && accesses && (
        <Card withBorder radius='md' p='lg' shadow='xs'>
          <Group justify='space-between' mb='sm'>
            <Title order={4}>Accesos al documento</Title>
            {d.status !== 'anulado' && (
              <Button
                size='xs'
                leftSection={<IconKey size={14} />}
                onClick={() => {
                  setGrantDept(null);
                  setGrantEmail('');
                  setGrantView(true);
                  setGrantDownload(false);
                  setGrantPrint(false);
                  setGrantExpires('');
                  setReason('');
                  setModal('acceso');
                }}
              >
                Otorgar acceso
              </Button>
            )}
          </Group>
          <Text size='xs' c='dimmed' mb='sm'>
            Pública interna: todos los que tienen consulta del SGC. Por departamento: el dueño y los autorizados aquí. Confidencial: solo los
            autorizados aquí. La descarga y la impresión son excepcionales y vencen.
          </Text>
          {accesses.length === 0 ? (
            <Text size='sm' c='dimmed'>
              Sin accesos adicionales.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={700}>
              <Table verticalSpacing='xs'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Para</Table.Th>
                    <Table.Th>Permisos</Table.Th>
                    <Table.Th>Vence</Table.Th>
                    <Table.Th>Motivo</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {accesses.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>
                        <Text size='sm'>{a.userEmail ?? deptName(a.idDepartment)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {a.canView && <Badge size='xs'>Consulta</Badge>}
                          {a.canDownload && <Badge size='xs' color='orange'>Descarga</Badge>}
                          {a.canPrint && <Badge size='xs' color='orange'>Impresión</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm'>{a.expiresAt ? a.expiresAt.slice(0, 10) : 'Sin vencimiento'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size='xs'>{a.reason}</Text>
                        <Text size='xs' c='dimmed'>
                          {a.grantedBy} · {a.createdAt.slice(0, 10)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {a.revokedAt ? (
                          <Badge size='xs' color='gray'>
                            Revocado {a.revokedAt.slice(0, 10)}
                          </Badge>
                        ) : (
                          <Badge size='xs' color='green'>
                            Activo
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {!a.revokedAt && (
                          <Button size='xs' variant='subtle' color='red' onClick={() => { setReason(''); setRevokeId(a.id); }}>
                            Revocar
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      <Modal opened={modal === 'editar'} onClose={() => setModal(null)} title='Editar documento' centered>
        <Stack>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Título' value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <SgcSelect
            label='Confidencialidad'
            data={SGC_CONFIDENTIALITY_LEVELS.map((c) => ({ value: c, label: SGC_CONFIDENTIALITY_LABELS[c] }))}
            value={conf}
            onChange={setConf}
            allowDeselect={false}
          />
          <SgcSelect
            label='Departamento dueño'
            data={departments.map((x) => ({ value: String(x.id), label: x.name }))}
            value={owner}
            onChange={setOwner}
            clearable
            searchable
          />
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo del cambio' description='Queda en la auditoría.' value={reason} onChange={(e) => setReason(e.currentTarget.value)} minRows={2} />
          <Button
            loading={busy}
            onClick={() =>
              run(
                () =>
                  sgcSend(`/api/sgc/documents/${d.idDocument}`, 'PATCH', {
                    title,
                    confidentiality: conf,
                    idOwnerDepartment: owner ? Number(owner) : null,
                    reason,
                  }),
                'Documento actualizado.'
              )
            }
          >
            Guardar
          </Button>
        </Stack>
      </Modal>

      <Modal opened={modal === 'anular'} onClose={() => setModal(null)} title='Anular documento' centered>
        <Stack>
          <Text size='sm'>
            El documento {d.code} dejará de aparecer en el listado maestro. Nada se borra: queda anulado con su motivo en la auditoría.
          </Text>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo de la anulación' value={reason} onChange={(e) => setReason(e.currentTarget.value)} minRows={2} />
          <Button color='red' loading={busy} onClick={() => run(() => sgcSend(`/api/sgc/documents/${d.idDocument}/annul`, 'POST', { reason }), 'Documento anulado.')}>
            Anular
          </Button>
        </Stack>
      </Modal>

      <Modal opened={modal === 'acceso'} onClose={() => setModal(null)} title='Otorgar acceso' centered>
        <Stack>
          <SgcSelect
            label='Departamento'
            data={departments.map((x) => ({ value: String(x.id), label: x.name }))}
            value={grantDept}
            onChange={(v) => {
              setGrantDept(v);
              if (v) setGrantEmail('');
            }}
            clearable
            searchable
          />
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
            label='o persona (correo)'
            value={grantEmail}
            onChange={(e) => {
              setGrantEmail(e.currentTarget.value);
              if (e.currentTarget.value) setGrantDept(null);
            }}
          />
          <Group>
            <Checkbox label='Consulta' checked={grantView} onChange={(e) => setGrantView(e.currentTarget.checked)} />
            <Checkbox label='Descarga (excepcional)' checked={grantDownload} onChange={(e) => setGrantDownload(e.currentTarget.checked)} />
            <Checkbox label='Impresión (excepcional)' checked={grantPrint} onChange={(e) => setGrantPrint(e.currentTarget.checked)} />
          </Group>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
            type='date'
            label='Vence'
            description='Obligatorio si incluye descarga o impresión.'
            value={grantExpires}
            onChange={(e) => setGrantExpires(e.currentTarget.value)}
          />
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' value={reason} onChange={(e) => setReason(e.currentTarget.value)} minRows={2} />
          <Button
            loading={busy}
            onClick={() =>
              run(
                () =>
                  sgcSend(`/api/sgc/documents/${d.idDocument}/access`, 'POST', {
                    idDepartment: grantDept ? Number(grantDept) : null,
                    userEmail: grantEmail || null,
                    canView: grantView,
                    canDownload: grantDownload,
                    canPrint: grantPrint,
                    // Vence al final del día elegido (hora de Colombia).
                    expiresAt: grantExpires ? `${grantExpires}T23:59:59-05:00` : null,
                    reason,
                  }),
                'Acceso otorgado.'
              )
            }
          >
            Otorgar
          </Button>
        </Stack>
      </Modal>

      <Modal opened={revokeId !== null} onClose={() => setRevokeId(null)} title='Revocar acceso' centered>
        <Stack>
          <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo' value={reason} onChange={(e) => setReason(e.currentTarget.value)} minRows={2} />
          <Button
            color='red'
            loading={busy}
            onClick={() => run(() => sgcSend(`/api/sgc/documents/${d.idDocument}/access/${revokeId}/revoke`, 'POST', { reason }), 'Acceso revocado.')}
          >
            Revocar
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default function FichaDocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SgcShell section='Ficha del documento' subtitle='Código, versión, historial y visor de copia controlada'>
      {(company) => <Ficha company={company} id={id} />}
    </SgcShell>
  );
}
