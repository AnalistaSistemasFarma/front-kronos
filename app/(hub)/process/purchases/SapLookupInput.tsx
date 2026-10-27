'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, Loader } from '@mantine/core';
import type { LookupKind, LookupOption } from '../../../../lib/purchases/lookups';

/**
 * Celda con autocompletar contra SAP (como los buscadores de linea de SAPSEND).
 * Consulta /api/purchases/lookup al escribir (minimo 2 caracteres, espera 300 ms).
 * Al elegir una opcion entrega su valor y los campos extra que llena.
 */

interface Props {
  companyId: string | number | null;
  kind: LookupKind;
  value: string;
  onChange: (value: string) => void;
  /** Al elegir una opcion: valor + campos extra (descripcion, nombre del proveedor...). */
  onSelect: (option: LookupOption) => void;
  error?: string;
  ariaLabel: string;
  /** Etiqueta visible (opcional) y tamaño del campo. */
  label?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
}

export default function SapLookupInput({ companyId, kind, value, onChange, onSelect, error, ariaLabel, label, size = 'xs' }: Props) {
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const lastQuery = useRef('');

  useEffect(() => {
    const q = value.trim();
    if (!companyId || q.length < 2 || q === lastQuery.current) {
      if (q.length < 2) setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/purchases/lookup?companyId=${companyId}&kind=${kind}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setOptions(Array.isArray(d.options) ? d.options : []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [companyId, kind, value]);

  return (
    <Autocomplete
      size={size}
      label={label}
      placeholder="Escriba para buscar en SAP"
      value={value}
      onChange={(v) => {
        // Al elegir una opción, Mantine escribe en el campo su ETIQUETA («51953005 · UTILES…»).
        // Ese texto no se guarda: el valor real (el código) lo pone onSelect.
        if (options.some((o) => o.label === v && o.label !== o.value)) return;
        onChange(v);
      }}
      data={options.map((o) => ({ value: o.value, label: o.label }))}
      filter={({ options: opts }) => opts}
      onOptionSubmit={(v) => {
        const opt = options.find((o) => o.value === v);
        lastQuery.current = v;
        if (opt) onSelect(opt);
      }}
      rightSection={loading ? <Loader size={12} /> : null}
      comboboxProps={{ withinPortal: true, zIndex: 1100 }}
      maxDropdownHeight={240}
      error={error}
      aria-label={ariaLabel}
    />
  );
}
