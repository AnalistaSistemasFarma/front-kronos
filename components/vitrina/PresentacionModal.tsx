'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Group, Modal, MultiSelect, NumberInput, SegmentedControl, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { VITRINA_FAMILIAS, VITRINA_FORMAS, VITRINA_LIMITS } from '../../lib/vitrina/constants';
import { parsePresentacionSugerida } from '../../lib/vitrina/rules';
import { sgcTouchComboboxProps } from '../sgc/SgcSelect';
import type { Area, BandejaItem, Presentacion } from './types';
import { errorTexto, OPCIONES_VISIBILIDAD, useVitrinaFetch, vitrinaSend } from './vitrinaClient';

/**
 * Crear una presentación con códigos de la bandeja, o editar una existente.
 * La presentación nace PENDIENTE y con visibilidad INTERNA por defecto; si es para
 * terceros, la visibilidad queda fija en «Interna» (el control se bloquea).
 * Se prellena con la sugerencia de la carga inicial o con el nombre de SAP.
 */
export interface PresentacionModalProps {
  opened: boolean;
  onClose: () => void;
  idCompany: number;
  /** Códigos de la bandeja para una presentación NUEVA. */
  codigos?: BandejaItem[];
  /** Presentación a editar. */
  presentacion?: Presentacion | null;
  onSaved: (texto: string) => void;
}

interface Form {
  molecula: string;
  concentracion: string;
  forma_farmaceutica: string;
  unidades_caja: number | string;
  nombre_comercial: string;
  tall_man: string;
  familia: string;
  visibilidad: string;
  es_para_terceros: boolean;
  destacada: boolean;
  areas: string[];
}

function formInicial(codigos: BandejaItem[] | undefined, p: Presentacion | null | undefined): Form {
  if (p) {
    return {
      molecula: p.molecula,
      concentracion: p.concentracion ?? '',
      forma_farmaceutica: p.formaFarmaceutica ?? '',
      unidades_caja: p.unidadesCaja ?? '',
      nombre_comercial: p.nombreComercial ?? '',
      tall_man: p.tallMan ?? '',
      familia: p.familia ?? '',
      visibilidad: p.visibilidad,
      es_para_terceros: p.esParaTerceros,
      destacada: p.destacada,
      areas: p.areas.map((a) => String(a.id)),
    };
  }
  const primero = codigos?.[0];
  const sug = parsePresentacionSugerida(primero?.sugerencia.presentacion ?? primero?.itemName);
  const terceros = Boolean(codigos?.some((c) => c.sugerencia.esParaTerceros));
  return {
    molecula: sug?.molecula ?? '',
    concentracion: sug?.concentracion ?? '',
    forma_farmaceutica: '',
    unidades_caja: primero?.sugerencia.unidades ?? sug?.unidades ?? '',
    nombre_comercial: sug?.nombreComercial ?? '',
    tall_man: '',
    familia: primero?.sugerencia.familia ?? '',
    visibilidad: 'INTERNA',
    es_para_terceros: terceros,
    destacada: false,
    areas: [],
  };
}

export default function PresentacionModal({ opened, onClose, idCompany, codigos, presentacion, onSaved }: PresentacionModalProps) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const { data: areasData } = useVitrinaFetch<{ areas: Area[] }>(opened ? `/api/vitrina/gestion/areas?company=${idCompany}` : null);
  const [form, setForm] = useState<Form>(() => formInicial(codigos, presentacion));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editar = Boolean(presentacion);

  useEffect(() => {
    if (opened) {
      setForm(formInicial(codigos, presentacion));
      setError(null);
    }
  }, [opened, codigos, presentacion]);

  const areas = useMemo(
    () => (areasData?.areas ?? []).filter((a) => a.activa || form.areas.includes(String(a.id))).map((a) => ({ value: String(a.id), label: a.activa ? a.nombre : `${a.nombre} (inactiva)` })),
    [areasData, form.areas]
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setBusy(true);
    setError(null);
    const body = {
      company: idCompany,
      molecula: form.molecula,
      concentracion: form.concentracion,
      forma_farmaceutica: form.forma_farmaceutica,
      unidades_caja: form.unidades_caja === '' ? null : form.unidades_caja,
      nombre_comercial: form.nombre_comercial,
      tall_man: form.tall_man,
      familia: form.familia,
      visibilidad: form.es_para_terceros ? 'INTERNA' : form.visibilidad,
      es_para_terceros: form.es_para_terceros,
      destacada: form.destacada,
      areas: form.areas.map(Number),
    };
    try {
      if (presentacion) {
        await vitrinaSend(`/api/vitrina/gestion/presentaciones/${presentacion.id}`, 'PATCH', body);
        onSaved(`Presentación «${form.molecula.trim()}» actualizada.`);
      } else {
        const r = await vitrinaSend<{ codigos: number }>('/api/vitrina/gestion/presentaciones', 'POST', { ...body, codigos: (codigos ?? []).map((c) => c.id) });
        onSaved(`Presentación «${form.molecula.trim()}» creada con ${r.codigos} código(s) SAP. Queda pendiente de validar y sin activar.`);
      }
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={editar ? 'Editar presentación' : 'Nueva presentación'} size='lg' fullScreen={mobile} radius='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} data-testid='vitrina-presentacion-error'>
            {error}
          </Alert>
        )}
        {!editar && codigos && codigos.length > 0 && (
          <div>
            <Text size='sm' fw={500} mb={4}>
              Códigos SAP que se agrupan ({codigos.length})
            </Text>
            <Group gap={6}>
              {codigos.map((c) => (
                <Badge key={c.id} variant='outline' size='md'>
                  {c.itemCode}
                </Badge>
              ))}
            </Group>
            {codigos[0].sugerencia.presentacion && (
              <Text size='xs' c='dimmed' mt={4}>
                Sugerencia de la carga inicial: {codigos[0].sugerencia.presentacion}
              </Text>
            )}
          </div>
        )}
        <TextInput label='Molécula' required size='md' value={form.molecula} onChange={(e) => set('molecula', e.currentTarget.value)} maxLength={VITRINA_LIMITS.molecula} data-testid='vitrina-molecula' />
        <Group grow wrap='wrap' gap='sm'>
          <TextInput label='Concentración' size='md' placeholder='1 g' value={form.concentracion} onChange={(e) => set('concentracion', e.currentTarget.value)} maxLength={VITRINA_LIMITS.concentracion} miw={160} />
          <NumberInput label='Unidades por caja' size='md' min={1} max={10000} allowDecimal={false} value={form.unidades_caja} onChange={(v) => set('unidades_caja', v)} miw={160} />
        </Group>
        <Group grow wrap='wrap' gap='sm'>
          <Autocomplete label='Forma farmacéutica' size='md' data={[...VITRINA_FORMAS]} value={form.forma_farmaceutica} onChange={(v) => set('forma_farmaceutica', v)} maxLength={VITRINA_LIMITS.forma} comboboxProps={sgcTouchComboboxProps()} miw={160} />
          <Autocomplete label='Familia' size='md' data={[...VITRINA_FAMILIAS]} value={form.familia} onChange={(v) => set('familia', v)} maxLength={VITRINA_LIMITS.familia} comboboxProps={sgcTouchComboboxProps()} miw={160} />
        </Group>
        <Group grow wrap='wrap' gap='sm'>
          <TextInput label='Nombre comercial' size='md' value={form.nombre_comercial} onChange={(e) => set('nombre_comercial', e.currentTarget.value)} maxLength={VITRINA_LIMITS.nombreComercial} miw={160} />
          <TextInput
            label='Nombre en Tall Man'
            description='Solo si está aprobado en el arte'
            size='md'
            value={form.tall_man}
            onChange={(e) => set('tall_man', e.currentTarget.value)}
            maxLength={VITRINA_LIMITS.tallMan}
            miw={160}
          />
        </Group>
        <MultiSelect
          label='Áreas asistenciales'
          size='md'
          data={areas}
          value={form.areas}
          onChange={(v) => set('areas', v)}
          searchable
          clearable
          comboboxProps={sgcTouchComboboxProps()}
          nothingFoundMessage='Sin áreas'
        />
        <Switch
          label='Fabricado para terceros'
          description='PISA, Bioselect y similares: la visibilidad queda fija en «Interna» y nunca sale en el modo presentación.'
          checked={form.es_para_terceros}
          onChange={(e) => set('es_para_terceros', e.currentTarget.checked)}
          size='md'
          data-testid='vitrina-terceros'
        />
        <div>
          <Text size='sm' fw={500} mb={4}>
            Visibilidad
          </Text>
          <SegmentedControl
            fullWidth
            size='md'
            data={OPCIONES_VISIBILIDAD}
            value={form.es_para_terceros ? 'INTERNA' : form.visibilidad}
            onChange={(v) => set('visibilidad', v)}
            disabled={form.es_para_terceros}
            data-testid='vitrina-visibilidad'
          />
          <Text size='xs' c='dimmed' mt={4}>
            Aunque elija «Vista al cliente» u «Ofertable», ningún código se muestra hasta activarlo a mano, con la presentación validada y el registro sanitario al día.
          </Text>
        </div>
        <Switch label='Destacada' checked={form.destacada} onChange={(e) => set('destacada', e.currentTarget.checked)} size='md' />
        {!editar && (
          <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />}>
            La presentación queda «Pendiente de validar» y sus códigos sin activar.
          </Alert>
        )}
        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='default' size='md' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='md' onClick={guardar} loading={busy} disabled={!form.molecula.trim()} data-testid='vitrina-guardar-presentacion'>
            {editar ? 'Guardar cambios' : 'Crear presentación'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
