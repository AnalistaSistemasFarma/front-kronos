'use client';

import { useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Code, Group, Modal, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconFileSearch, IconShieldCheck } from '@tabler/icons-react';
import type { SgcDocumentAuditReport } from '../../../lib/sgc/db/auditReport';
import type { SgcPdfVerification } from '../../../lib/sgc/pdf/controlledPdf';
import { formatDateCO } from '../tareas/format';

/**
 * Verificación del PDF controlado y REPORTE DE AUDITORÍA del documento
 * (Sprint 3). La verificación compara el archivo con su huella registrada, el
 * manifiesto de firmas incrustado con el guardado y cada firma con su
 * registro íntegro; el reporte reúne todo lo que le pasó al documento.
 */

type Verification = SgcPdfVerification & { hasManifest: boolean; code: string; versionNumber: number };

export function SgcVerifyVersionButton({ idDocument, idVersion }: { idDocument: number; idVersion: number }) {
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sgc/documents/${idDocument}/versions/${idVersion}/verify`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setResult(body as Verification);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size='xs' variant='subtle' leftSection={<IconShieldCheck size={14} />} onClick={run} loading={busy} data-testid='sgc-verificar-version'>
        Verificar
      </Button>
      <Modal opened={Boolean(result || error)} onClose={() => { setResult(null); setError(null); }} title='Verificación del PDF controlado' centered size='lg'>
        {error && <Alert color='red'>{error}</Alert>}
        {result && (
          <Stack gap='xs' data-testid='sgc-verificacion' data-ok={String(result.ok)}>
            <Alert color={result.ok ? 'teal' : 'red'} icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />} title={result.ok ? 'Íntegro' : 'No superó la verificación'}>
              {result.code} V{result.versionNumber}
              {!result.hasManifest && ' · versión cargada en la carga inicial (sin manifiesto de firmas): solo se verifica su huella.'}
            </Alert>
            <Text size='sm'>
              Huella del archivo: <Code>{result.pdfSha256}</Code> — {result.pdfMatches ? 'coincide con la registrada' : 'NO coincide con la registrada'}
            </Text>
            {result.hasManifest && (
              <Text size='sm'>
                Manifiesto de firmas: {result.manifestFound ? (result.manifestMatches ? 'presente y coincide con el registrado' : 'presente pero NO coincide') : 'no encontrado'}
              </Text>
            )}
            {result.signatures.map((s) => (
              <Text key={s.uid} size='sm'>
                <Badge size='xs' color={s.ok ? 'teal' : 'red'} mr={6}>
                  {s.ok ? 'OK' : 'Falla'}
                </Badge>
                {s.meaningLabel} — {s.signer}
                {s.problem ? `: ${s.problem}` : ''}
              </Text>
            ))}
            {result.problems.length > 0 && (
              <Alert color='red' title='Problemas'>
                {result.problems.map((p) => (
                  <Text size='sm' key={p}>
                    {p}
                  </Text>
                ))}
              </Alert>
            )}
          </Stack>
        )}
      </Modal>
    </>
  );
}

export function SgcDocumentAuditCard({ idDocument }: { idDocument: number }) {
  const [report, setReport] = useState<SgcDocumentAuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sgc/documents/${idDocument}/audit`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setReport(body as SgcDocumentAuditReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-reporte-auditoria'>
      <Group justify='space-between' mb='sm'>
        <Title order={4} className='flex items-center gap-2'>
          <IconFileSearch size={18} /> Reporte de auditoría
        </Title>
        <Group gap='xs'>
          <Button size='xs' onClick={load} loading={busy} data-testid='sgc-reporte-cargar'>
            {report ? 'Actualizar' : 'Generar reporte'}
          </Button>
          {report && (
            <Anchor href={`/api/sgc/documents/${idDocument}/audit?formato=csv`} size='sm'>
              Exportar CSV
            </Anchor>
          )}
        </Group>
      </Group>
      <Text size='xs' c='dimmed' mb='sm'>
        Todo lo que le pasó al documento (cargas, consultas, accesos, solicitudes, decisiones, firmas y PDF controlados), desde el registro de auditoría inmodificable. La consulta del reporte también queda registrada.
      </Text>
      {error && <Alert color='red'>{error}</Alert>}
      {report && (
        <Stack gap='sm'>
          <Group gap='xs'>
            <Badge color={report.signatureChain.ok ? 'teal' : 'red'} data-testid='sgc-cadena-firmas'>
              Cadena de firmas de la empresa: {report.signatureChain.ok ? `íntegra (${report.signatureChain.checked})` : 'ROTA'}
            </Badge>
            <Badge variant='light'>{report.events.length} eventos</Badge>
            <Badge variant='light'>{report.signatures.length} firmas</Badge>
          </Group>
          {report.signatures.length > 0 && (
            <ScrollArea type='auto'>
              <Table withTableBorder verticalSpacing={4} miw={760}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Firma</Table.Th>
                    <Table.Th>Firmante</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Motivo</Table.Th>
                    <Table.Th>Integridad</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {report.signatures.map((s) => (
                    <Table.Tr key={s.uid}>
                      <Table.Td>
                        {s.meaningLabel} · #{s.idRequest}
                      </Table.Td>
                      <Table.Td>{s.signer}</Table.Td>
                      <Table.Td>{formatDateCO(s.signedAt)}</Table.Td>
                      <Table.Td>{s.reason}</Table.Td>
                      <Table.Td>
                        <Badge size='xs' color={s.intact ? 'teal' : 'red'}>
                          {s.intact ? 'Íntegra' : 'Alterada'}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          <ScrollArea h={360} type='auto'>
            <Table withTableBorder striped verticalSpacing={4} miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Quién</Table.Th>
                  <Table.Th>Acción</Table.Th>
                  <Table.Th>Sobre</Table.Th>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>Detalle</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.events.map((e) => (
                  <Table.Tr key={e.id} data-testid='sgc-reporte-evento' data-action={e.action}>
                    <Table.Td>
                      <Text size='xs'>{formatDateCO(e.at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>{e.actor}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Code>{e.action}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>
                        {e.entity} {e.entityId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>{e.ip}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>{e.detail}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Stack>
      )}
    </Card>
  );
}
