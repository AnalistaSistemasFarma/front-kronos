'use client';

import React, { useMemo, useState } from 'react';
import { Combobox, InputBase, ScrollArea, Text, useCombobox } from '@mantine/core';

/**
 * Lista seleccionable con búsqueda para Titular / Fabricante, alimentada con
 * los nombres ya usados en SAP. Permite "Añadir nuevo" desde la misma lista:
 * el valor nuevo queda guardado en el registro y desde ahí aparece en la lista
 * para los siguientes. Respeta el largo máximo del campo en SAP (maxLength +
 * contador), que varía por empresa.
 */
interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  maxLength?: number;
  disabled?: boolean;
  loading?: boolean;
}

const MAX_VISIBLE = 100;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export default function NameCombobox({ label, value, onChange, options, maxLength, disabled, loading }: Props) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [search, setSearch] = useState<string | null>(null);

  // Al enfocar, el texto conserva el valor actual y la lista muestra todo; solo
  // filtra cuando el usuario escribe algo distinto.
  const query = search != null && search !== value ? search : '';
  const filtered = useMemo(() => {
    const q = normalize(query);
    const list = q ? options.filter((o) => normalize(o).includes(q)) : options;
    return list.slice(0, MAX_VISIBLE);
  }, [options, query]);

  const nuevo = query.trim();
  const existeExacto = nuevo !== '' && options.some((o) => normalize(o) === normalize(nuevo));
  const muyLargo = maxLength != null && nuevo.length > maxLength;

  const shown = search ?? value;
  const len = shown.length;
  const over = maxLength != null && len > maxLength;

  return (
    <Combobox
      store={combobox}
      withinPortal
      onOptionSubmit={(val) => {
        if (val === '$create') {
          if (!muyLargo) onChange(nuevo);
        } else {
          onChange(val);
        }
        setSearch(null);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <InputBase
          label={label}
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          value={shown}
          disabled={disabled}
          maxLength={maxLength}
          placeholder="Buscar o añadir"
          description={maxLength ? `${len}/${maxLength} caracteres` : undefined}
          error={over ? `Máximo ${maxLength} caracteres` : undefined}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onClick={() => combobox.openDropdown()}
          onFocus={() => {
            setSearch(value);
            combobox.openDropdown();
          }}
          onBlur={() => {
            setSearch(null);
            combobox.closeDropdown();
          }}
        />
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          <ScrollArea.Autosize mah={240} type="scroll">
            {loading && <Combobox.Empty>Cargando…</Combobox.Empty>}
            {filtered.map((o) => (
              <Combobox.Option value={o} key={o} active={o === value}>
                {o}
              </Combobox.Option>
            ))}
            {!loading && nuevo !== '' && !existeExacto && (
              <Combobox.Option value="$create" disabled={muyLargo}>
                <Text size="sm" fw={600} c={muyLargo ? 'red' : undefined}>
                  {muyLargo
                    ? `No se puede añadir: supera ${maxLength} caracteres`
                    : `+ Añadir nuevo: "${nuevo}"`}
                </Text>
              </Combobox.Option>
            )}
            {!loading && filtered.length === 0 && nuevo === '' && (
              <Combobox.Empty>Sin valores registrados; escriba para añadir</Combobox.Empty>
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
