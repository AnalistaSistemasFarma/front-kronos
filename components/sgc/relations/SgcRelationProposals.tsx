'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconLink, IconX } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';

/**
 * «RELACIONAR DOCUMENTOS» (Sprint 9, solo Calidad): el sistema propone las
 * relaciones por el número del código y por el «documento padre» del listado
 * maestro (OLP-GCC-02 → sus formatos e instructivos); Calidad las confirma
 * una por una o en bloque, o las descarta con motivo. Solo las confirmadas
 * aparecen en el mapa.
 */
interface Proposal {
  id: number;
  type: string;
  typeLabel: string;
  origin: string;
  reason: string;
  source: { id: number; code: string; title: string };
  target: { id: number; code: string; title: string };
}

const ORIGIN: Record<string, string> = { listado: 'Listado maestro', codigo: 'Código' };

export default function SgcRelationProposals({ idCompany, onChanged }: { idCompany: number; onChanged: () => void }) {
  const { data, reload } = useSgcFetch<{ proposals: Proposal[] }>(`/api/sgc/relations/proposals?company=${idCompany}`);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const proposals = data?.proposals ?? [];

  const run = async (body: Record<string, unknown>, ok: (r: Record<string, number>) => string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await sgcSend<Record<string, number>>('/api/sgc/relations/proposals', 'POST', { company: idCompany, ...body });
      setFeedback({ ok: true, text: ok(r) });
      setSelected([]);
      setReason('');
      reload();
      onChanged();
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder radius='md' p='md' mb='md' data-testid='sgc-relacionar'>
      <Group justify='space-between' wrap='wrap'>
        <div>
          <Text fw={600}>Relacionar documentos</Text>
          <Text size='sm' c='dimmed'>
            Propone las relaciones por el código y el listado maestro (procedimiento → sus formatos e instructivos). Calidad las confirma antes de que aparezcan en el mapa.
          </Text>
        </div>
        <Group gap='xs'>
          <Button leftSection={<IconLink size={16} />} loading={busy && !open} onClick={() => void run({ action: 'proponer' }, (r) => (r.created ? `${r.created} relación(es) propuesta(s): revíselas y confírmelas.` : 'No hay relaciones nuevas que proponer.'))} data-testid='sgc-relacionar-proponer'>
            Relacionar documentos
          </Button>
          <Button variant='light' disabled={proposals.length === 0} onClick={() => setOpen(true)} data-testid='sgc-relacionar-revisar'>
            Revisar propuestas ({proposals.length})
          </Button>
        </Group>
      </Group>
      {feedback && !open && (
        <Alert mt='sm' color={feedback.ok ? 'green' : 'red'} icon={feedback.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} withCloseButton onClose={() => setFeedback(null)} data-testid='sgc-relacionar-mensaje'>
          {feedback.text}
        </Alert>
      )}

      <Modal opened={open} onClose={() => setOpen(false)} title='Relaciones propuestas' size='xl'>
        <Stack gap='sm'>
          {feedback && (
            <Alert color={feedback.ok ? 'green' : 'red'} icon={feedback.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}>
              {feedback.text}
            </Alert>
          )}
          <ScrollArea.Autosize mah={420}>
            <Table striped withTableBorder stickyHeader verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox aria-label='Seleccionar todas' checked={proposals.length > 0 && selected.length === proposals.length} indeterminate={selected.length > 0 && selected.length < proposals.length} onChange={(e) => setSelected(e.currentTarget.checked ? proposals.map((p) => p.id) : [])} />
                  </Table.Th>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Relación</Table.Th>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Por qué</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {proposals.map((p) => (
                  <Table.Tr key={p.id} data-testid='sgc-relacion-propuesta'>
                    <Table.Td>
                      <Checkbox aria-label={`Seleccionar ${p.source.code}`} checked={selected.includes(p.id)} onChange={(e) => setSelected(e.currentTarget.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
                    </Table.Td>
                    <Table.Td ff='monospace'>{p.source.code}</Table.Td>
                    <Table.Td>
                      <Badge variant='light'>{p.typeLabel}</Badge>
                    </Table.Td>
                    <Table.Td ff='monospace'>{p.target.code}</Table.Td>
                    <Table.Td>
                      <Badge size='xs' color='gray' variant='light' mr={4}>
                        {ORIGIN[p.origin] ?? p.origin}
                      </Badge>
                      <Text span size='xs'>
                        {p.reason}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <TextInput label='Motivo (para descartar)' placeholder='No corresponde: el formato es de otro procedimiento' value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoComplete='off' />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button color='red' variant='light' leftSection={<IconX size={16} />} disabled={!selected.length || reason.trim().length < 10} loading={busy} onClick={() => void run({ action: 'descartar', ids: selected, reason }, (r) => `${r.discarded} propuesta(s) descartada(s).`)} data-testid='sgc-relacionar-descartar'>
              Descartar seleccionadas
            </Button>
            <Button leftSection={<IconCheck size={16} />} disabled={!selected.length} loading={busy} onClick={() => void run({ action: 'confirmar', ids: selected }, (r) => `${r.confirmed} relación(es) confirmada(s): ya aparecen en el mapa.`)} data-testid='sgc-relacionar-confirmar'>
              Confirmar seleccionadas ({selected.length})
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
