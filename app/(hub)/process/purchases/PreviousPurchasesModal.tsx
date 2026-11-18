'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, ScrollArea, SegmentedControl, Select, Table, Text, TextInput } from '@mantine/core';
import { IconCopy, IconEye, IconPaperclip, IconRefresh, IconSearch } from '@tabler/icons-react';
import { stateColor, stateLabel } from '../../../../lib/purchases/fields';
import PurchaseInlineForm from './PurchaseInlineForm';
import { LINE_COLUMNS } from './PurchaseRequestDetail';
import CompanyLogo from '../../../../components/ui/CompanyLogo';

/**
 * PROVISIONAL (Nicolás Rivera, 2026-11-18): solicitudes de compra anteriores, creadas en SAPSEND,
 * de todas las empresas del usuario, leídas en vivo de SAP. Se pueden duplicar como solicitud nueva
 * en SynerLink. No se migra nada: se consulta SAP.
 */

interface Row {
  companyId: number;
  companyName: string;
  DocEntry: number;
  DocDate?: string;
  RequriedDate?: string;
  U_SEND_State?: string | null;
  U_SEND_UserName?: string;
  Comments?: string;
  DocTotal?: number;
  DocCurrency?: string;
  U_SEND_SolCom?: string | null;
}
interface CompanyInfo {
  idCompany: number;
  companyName: string;
  canSeeAll: boolean;
  hasProfile: boolean;
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const money = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 }));

export default function PreviousPurchasesModal({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (message: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [company, setCompany] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [errors, setErrors] = useState<{ company: string; error: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [dup, setDup] = useState<Row | null>(null);
  /** Detalle de una solicitud anterior antes de duplicarla. */
  const [view, setView] = useState<Row | null>(null);
  const [viewData, setViewData] = useState<{ item: Record<string, unknown> & { DocumentLines?: Record<string, unknown>[] }; attachments: string[] } | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    setViewData(null);
    setViewError(null);
    fetch(`/api/purchases/previous/item?companyId=${view.companyId}&docEntry=${view.DocEntry}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar la solicitud');
        if (!cancelled) setViewData({ item: d.item, attachments: d.attachments ?? [] });
      })
      .catch((e: Error) => {
        if (!cancelled) setViewError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q.trim()) params.set('q', q.trim());
      if (company) params.set('companyId', company);
      const r = await fetch(`/api/purchases/previous?${params}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo consultar SAP');
      setRows(d.rows ?? []);
      setCompanies(d.companies ?? []);
      setErrors(d.errors ?? []);
      if (!from) setFrom(d.from ?? '');
      if (!to) setTo(d.to ?? '');
    } catch (e) {
      setErrors([{ company: 'SAP', error: (e as Error).message }]);
    } finally {
      setLoading(false);
    }
  }, [scope, from, to, q, company]);

  useEffect(() => {
    if (opened) void load();
    // Solo al abrir y al cambiar «Mías / Todas» o la empresa; las fechas y el texto se aplican con «Buscar».
  }, [opened, scope, company]);

  const canSeeAll = companies.some((c) => c.canSeeAll);
  const noProfile = companies.filter((c) => !c.hasProfile).map((c) => c.companyName);
  const companyOptions = useMemo(
    () => [{ value: '', label: 'Todas las compañías' }, ...companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))],
    [companies]
  );

  return (
    <>
      <Modal opened={opened && !dup && !view} onClose={onClose} size="95%" title={<Text fw={700}>Solicitudes de compra anteriores (SAP)</Text>}>
        <Text size="sm" c="dimmed" mb="sm">
          Las solicitudes creadas antes en SAPSEND, consultadas en el SAP de cada compañía. Use «Duplicar» para crearla como una
          solicitud nueva en SynerLink (se copian comentarios y líneas; las fechas se ponen de nuevo).
        </Text>
        <Group align="flex-end" gap="sm" mb="sm" wrap="wrap">
          <TextInput type="date" label="Desde" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
          <TextInput type="date" label="Hasta" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
          <Select label="Compañía" data={companyOptions} value={company ?? ''} onChange={(v) => setCompany(v || null)} allowDeselect={false} w={220} comboboxProps={{ withinPortal: true, zIndex: 1300 }} />
          <TextInput
            label="Buscar"
            placeholder="Comentario o solicitante"
            leftSection={<IconSearch size={14} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
          />
          {canSeeAll && (
            <SegmentedControl
              value={scope}
              onChange={(v) => setScope(v as 'mine' | 'all')}
              data={[
                { value: 'mine', label: 'Mis solicitudes' },
                { value: 'all', label: 'Todas (Compras)' },
              ]}
            />
          )}
          <Button leftSection={<IconRefresh size={14} />} loading={loading} onClick={() => void load()}>
            Buscar
          </Button>
        </Group>
        {noProfile.length > 0 && scope === 'mine' && (
          <Alert color="yellow" mb="sm">
            Sin perfil de SAPSEND en: {noProfile.join(', ')}. Ahí no se pueden mostrar sus solicitudes anteriores.
          </Alert>
        )}
        {errors.map((e) => (
          <Alert key={e.company} color="red" mb="xs">
            {e.company}: {e.error}
          </Alert>
        ))}
        <ScrollArea h="62vh" type="auto">
          <Table striped highlightOnHover stickyHeader verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Compañía</Table.Th>
                <Table.Th>Borrador</Table.Th>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Solicitante</Table.Th>
                <Table.Th>Comentarios</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={`${r.companyId}-${r.DocEntry}`}>
                  <Table.Td>
                    <CompanyLogo name={r.companyName} />
                  </Table.Td>
                  <Table.Td>
                    #{r.DocEntry}
                    {r.U_SEND_SolCom && /^\d+$/.test(String(r.U_SEND_SolCom)) ? (
                      <Text size="xs" c="dimmed">
                        En firme {r.U_SEND_SolCom}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>{day(r.DocDate)}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={stateColor(r.U_SEND_State)} styles={{ root: { textTransform: 'none' } }}>
                      {stateLabel(r.U_SEND_State)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{r.U_SEND_UserName ?? ''}</Table.Td>
                  <Table.Td style={{ maxWidth: 420 }}>
                    <Text size="sm" lineClamp={2}>
                      {r.Comments ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {money(r.DocTotal)} {r.DocCurrency ?? ''}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Button size="xs" variant="default" leftSection={<IconEye size={14} />} onClick={() => setView(r)}>
                        Ver
                      </Button>
                      <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => setDup(r)}>
                        Duplicar
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {loading && (
            <Group justify="center" my="md">
              <Loader size="sm" />
            </Group>
          )}
          {!loading && rows.length === 0 && (
            <Text c="dimmed" size="sm" ta="center" my="md">
              No hay solicitudes en ese rango.
            </Text>
          )}
        </ScrollArea>
        <Text size="xs" c="dimmed" mt="xs">
          {rows.length} solicitud(es) · máximo 200 por compañía (las más recientes) · rango de hasta un año.
        </Text>
      </Modal>

      <Modal
        opened={Boolean(dup)}
        onClose={() => setDup(null)}
        fullScreen
        title={
          <Text fw={700}>
            Nueva solicitud de compra · {dup?.companyName} · duplicada del borrador #{dup?.DocEntry}
          </Text>
        }
      >
        {dup && (
          <PurchaseInlineForm
            companyId={String(dup.companyId)}
            duplicate={{ docEntry: dup.DocEntry }}
            onDone={({ message }) => {
              setDup(null);
              onCreated(message);
            }}
          />
        )}
      </Modal>
      <Modal
        opened={Boolean(view)}
        onClose={() => setView(null)}
        size="95%"
        title={
          <Group gap="sm">
            {view && <CompanyLogo name={view.companyName} />}
            <Text fw={700}>Solicitud de compra · borrador #{view?.DocEntry}</Text>
          </Group>
        }
      >
        {viewError && <Alert color="red">{viewError}</Alert>}
        {!viewData && !viewError && <Loader size="sm" />}
        {viewData && (() => {
          const d = viewData.item;
          const lines = d.DocumentLines ?? [];
          const cols = LINE_COLUMNS.filter((c) => !c.optional || lines.some((l, i) => String(c.render(l, i) ?? '').trim() !== ''));
          const motivo = String(d.U_Motivo_Can_Solicitud ?? '').trim();
          return (
            <>
              <Group gap="xl" mb="md" wrap="wrap">
                <div>
                  <Text size="xs" c="dimmed">Estado</Text>
                  <Badge variant="light" color={stateColor(d.U_SEND_State as string)} styles={{ root: { textTransform: 'none' } }}>
                    {stateLabel(d.U_SEND_State as string)}
                  </Badge>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Solicitante</Text>
                  <Text size="sm" fw={600}>{String(d.U_SEND_UserName ?? '—')}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Fecha / requerida</Text>
                  <Text size="sm">{day(d.DocDate)} · {day(d.RequriedDate) || '—'}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text size="sm" fw={700}>{money(d.DocTotal)} {String(d.DocCurrency ?? '')}</Text>
                </div>
                {d.U_SEND_SolCom && /^\d+$/.test(String(d.U_SEND_SolCom)) ? (
                  <div>
                    <Text size="xs" c="dimmed">En firme</Text>
                    <Text size="sm">N.º {String(d.U_SEND_SolCom)}</Text>
                  </div>
                ) : null}
              </Group>
              <Text size="xs" c="dimmed">Comentarios</Text>
              <Text size="sm" mb="md" style={{ whiteSpace: 'pre-line' }}>{String(d.Comments ?? '—')}</Text>
              {motivo && (
                <Alert color="red" variant="light" mb="md" title="Motivo de rechazo o anulación">
                  {motivo}
                </Alert>
              )}
              <Table.ScrollContainer minWidth={Math.max(600, cols.length * 95)}>
                <Table withTableBorder striped verticalSpacing={4} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      {cols.map((c) => (
                        <Table.Th key={c.label} style={{ textAlign: c.align ?? 'left', whiteSpace: 'nowrap' }}>{c.label}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        {cols.map((c) => (
                          <Table.Td key={c.label} style={{ textAlign: c.align ?? 'left' }}>{c.render(l, i)}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {viewData.attachments.length > 0 && (
                <Group gap={6} mt="sm">
                  <IconPaperclip size={14} />
                  <Text size="xs" c="dimmed">
                    Anexos: {viewData.attachments.join(' · ')} (al duplicar no se copian; adjunte las cotizaciones nuevas)
                  </Text>
                </Group>
              )}
              <Group justify="flex-end" mt="md">
                <Button variant="default" onClick={() => setView(null)}>Volver</Button>
                <Button
                  leftSection={<IconCopy size={14} />}
                  onClick={() => {
                    const r = view;
                    setView(null);
                    setDup(r);
                  }}
                >
                  Duplicar esta solicitud
                </Button>
              </Group>
            </>
          );
        })()}
      </Modal>
    </>
  );
}
