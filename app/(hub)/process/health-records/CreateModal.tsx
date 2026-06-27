'use client';

import React, { useState } from 'react';
import {
  Modal, Select, TextInput, Textarea, Button, Group, Stack, Alert, NumberInput, SimpleGrid, Loader,
} from '@mantine/core';
import { PAISES, ESTADOS, OBSOLETO } from '../../../../lib/health-records/fields';

interface WritableCompany {
  idCompany: number;
  companyName: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  companies: WritableCompany[];
  onCreated: () => void;
}

const EMPTY = {
  U_Referencia: '',
  U_Descripcion: '',
  U_Pais: 'COLOMBIA',
  U_Registro_Sanitario: '',
  U_Vida_Util: '',
  U_Fecha_Creacion: '',
  U_Fecha_Actualizacion: '',
  U_Fecha_Vencimiento: '',
  U_Codigo_IUM: '',
  U_Codigo_CUM: '',
  U_Fabricante: 'N/A',
  U_Titular: 'N/A',
  U_Estado_Entrada: 'Inactivo',
  U_Estado_Comercializacion: 'Inactivo',
  U_Obsoleto: 'NO',
  U_SEND_Link: '',
};

interface ItemResult {
  itemCode: string;
  itemName: string;
  cum: string;
}

export default function CreateModal({ opened, onClose, companies, onCreated }: Props) {
  const [companyId, setCompanyId] = useState<string | null>(
    companies[0] ? String(companies[0].idCompany) : null
  );
  const [record, setRecord] = useState({ ...EMPTY });
  const [comentario, setComentario] = useState('');
  const [articleQuery, setArticleQuery] = useState('');
  const [articleResults, setArticleResults] = useState<ItemResult[]>([]);
  const [searchingItems, setSearchingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string, value: string) => setRecord((r) => ({ ...r, [field]: value }));

  const searchItems = async (q: string) => {
    setArticleQuery(q);
    if (!companyId || q.trim().length < 2) {
      setArticleResults([]);
      return;
    }
    setSearchingItems(true);
    try {
      const res = await fetch(`/api/health-records/items?companyId=${companyId}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setArticleResults(data.items ?? []);
    } catch {
      setArticleResults([]);
    } finally {
      setSearchingItems(false);
    }
  };

  const pickItem = (it: ItemResult) => {
    setRecord((r) => ({ ...r, U_Referencia: it.itemCode, U_Descripcion: it.itemName, U_Codigo_CUM: it.cum }));
    setArticleQuery(`${it.itemCode} — ${it.itemName}`);
    setArticleResults([]);
  };

  const reset = () => {
    setRecord({ ...EMPTY });
    setComentario('');
    setArticleQuery('');
    setArticleResults([]);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!companyId) return setError('Seleccione una empresa');
    if (!record.U_Registro_Sanitario.trim()) return setError('El numero de registro sanitario es obligatorio');
    if (!record.U_Fecha_Creacion || !record.U_Fecha_Actualizacion)
      return setError('Las fechas de creacion y actualizacion son obligatorias');

    setSaving(true);
    try {
      const res = await fetch('/api/health-records/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), record, comentario }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo crear el registro');
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch {
      setError('Error de red al crear el registro');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Crear registro sanitario" size="lg">
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

        <TextInput
          label="Buscar articulo (Codigo o Nombre)"
          placeholder="Escriba para buscar en SAP"
          value={articleQuery}
          onChange={(e) => searchItems(e.currentTarget.value)}
          rightSection={searchingItems ? <Loader size="xs" /> : null}
        />
        {articleResults.length > 0 && (
          <Stack gap={2} style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #eee', padding: 4 }}>
            {articleResults.map((it) => (
              <Button key={it.itemCode} variant="subtle" size="xs" justify="flex-start" onClick={() => pickItem(it)}>
                {it.itemCode} — {it.itemName}
              </Button>
            ))}
          </Stack>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Referencia" value={record.U_Referencia} onChange={(e) => set('U_Referencia', e.currentTarget.value)} />
          <TextInput label="Descripcion" value={record.U_Descripcion} disabled />
          <TextInput label="Registro Sanitario" required value={record.U_Registro_Sanitario} onChange={(e) => set('U_Registro_Sanitario', e.currentTarget.value)} />
          <Select label="Pais" data={PAISES} value={record.U_Pais} onChange={(v) => set('U_Pais', v ?? 'COLOMBIA')} />
          <NumberInput label="Vida util (meses)" value={record.U_Vida_Util === '' ? '' : Number(record.U_Vida_Util)} onChange={(v) => set('U_Vida_Util', String(v ?? ''))} min={0} />
          <TextInput label="Fecha creacion" type="date" required value={record.U_Fecha_Creacion} onChange={(e) => set('U_Fecha_Creacion', e.currentTarget.value)} />
          <TextInput label="Fecha actualizacion" type="date" required value={record.U_Fecha_Actualizacion} onChange={(e) => set('U_Fecha_Actualizacion', e.currentTarget.value)} />
          <TextInput label="Fecha vencimiento" type="date" value={record.U_Fecha_Vencimiento} onChange={(e) => set('U_Fecha_Vencimiento', e.currentTarget.value)} />
          <TextInput label="Codigo CUM" value={record.U_Codigo_CUM} onChange={(e) => set('U_Codigo_CUM', e.currentTarget.value)} />
          <TextInput label="Codigo IUM" value={record.U_Codigo_IUM} onChange={(e) => set('U_Codigo_IUM', e.currentTarget.value)} />
          <TextInput label="Titular" value={record.U_Titular} onChange={(e) => set('U_Titular', e.currentTarget.value)} />
          <TextInput label="Fabricante" value={record.U_Fabricante} onChange={(e) => set('U_Fabricante', e.currentTarget.value)} />
          <Select label="Estado entrada" data={ESTADOS} value={record.U_Estado_Entrada} onChange={(v) => set('U_Estado_Entrada', v ?? 'Inactivo')} />
          <Select label="Estado comercializacion" data={ESTADOS} value={record.U_Estado_Comercializacion} onChange={(v) => set('U_Estado_Comercializacion', v ?? 'Inactivo')} />
          <Select label="Obsoleto" data={OBSOLETO} value={record.U_Obsoleto} onChange={(v) => set('U_Obsoleto', v ?? 'NO')} />
          <TextInput label="Enlace archivo" value={record.U_SEND_Link} onChange={(e) => set('U_SEND_Link', e.currentTarget.value)} />
        </SimpleGrid>

        <Textarea label="Comentario (queda en la bitacora)" value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} minRows={2} />

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Crear</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
