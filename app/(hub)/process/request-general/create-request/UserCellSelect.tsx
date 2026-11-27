'use client';

import { useEffect, useState } from 'react';
import { Select } from '@mantine/core';

/**
 * Celda «Persona» de un campo tabla (2026-11-26; Calidad OLP: «el grupo auditor se elige de todas las personas de la
 * compañía»). Lista los usuarios activos de SynerLink; guarda «Nombre · correo» para que se lea igual en todas partes.
 */
let cache: Promise<{ value: string; label: string }[]> | null = null;
function usuarios() {
  cache ??= fetch('/api/requests-general/users-emails', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d: { users?: { name: string | null; email: string | null }[] }) =>
      (d.users ?? [])
        .filter((u) => u.email)
        .map((u) => {
          const v = `${u.name?.trim() || u.email} · ${u.email}`;
          return { value: v, label: v };
        })
    )
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

export default function UserCellSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [data, setData] = useState<{ value: string; label: string }[]>(value ? [{ value, label: value }] : []);
  useEffect(() => {
    void usuarios().then((list) => setData(value && !list.some((x) => x.value === value) ? [{ value, label: value }, ...list] : list));
  }, [value]);
  return (
    <Select
      size='xs'
      placeholder='Busque la persona'
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      limit={50}
      nothingFoundMessage='Sin coincidencias'
      comboboxProps={{ withinPortal: true }}
      data-testid='tabla-celda-persona'
    />
  );
}
