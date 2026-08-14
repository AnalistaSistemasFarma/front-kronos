'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Select, Loader } from '@mantine/core';
import { IconDatabaseSearch } from '@tabler/icons-react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  /** field_type de la fuente SAP (ej. 'sap_items'). */
  source: string;
  /** Empresa seleccionada en el formulario; sin ella no se puede consultar. */
  companyId?: number;
  label: string;
  required?: boolean;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * Selector buscable poblado en vivo desde SAP (Service Layer) para un campo de
 * formulario tipo "consulta SAP". Consulta /api/requests-general/sap-options con la
 * empresa elegida; guarda el valor mostrado ("codigo - nombre") como texto.
 */
export default function SapOptionSelect({
  source,
  companyId,
  label,
  required,
  value,
  onChange,
  error,
}: Props) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [sapError, setSapError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setOptions([]);
      setSapError(null);
      return;
    }
    const term = searchValue.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/requests-general/sap-options?companyId=${companyId}&source=${encodeURIComponent(
            source
          )}&q=${encodeURIComponent(term)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setSapError(data.error || 'No se pudieron cargar los datos de SAP.');
          setOptions([]);
        } else {
          setSapError(null);
          setOptions(data.options || []);
        }
      } catch {
        if (active) {
          setSapError('No se pudo consultar SAP.');
          setOptions([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchValue, companyId, source]);

  // El valor elegido debe seguir presente en `data` aunque ya no este en la ultima
  // busqueda, para que el Select muestre la etiqueta seleccionada.
  const data = useMemo(() => {
    const arr = [...options];
    if (value && !arr.some((o) => o.value === value)) {
      arr.unshift({ value, label: value });
    }
    return arr;
  }, [options, value]);

  return (
    <Select
      label={label}
      required={required}
      data={data}
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      searchable
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      disabled={!companyId}
      clearable
      placeholder={
        !companyId ? 'Seleccione una empresa primero' : 'Escriba para buscar en SAP'
      }
      nothingFoundMessage={
        !companyId
          ? 'Seleccione una empresa'
          : searchValue.trim().length < 2
          ? 'Escriba al menos 2 caracteres'
          : loading
          ? 'Buscando...'
          : 'Sin resultados'
      }
      rightSection={loading ? <Loader size={16} /> : undefined}
      error={error || sapError || undefined}
      leftSection={<IconDatabaseSearch size={16} />}
    />
  );
}
