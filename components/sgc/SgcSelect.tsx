'use client';

import { NativeSelect, Select, type ComboboxItem, type ComboboxProps, type NativeSelectProps, type SelectProps } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

/**
 * Selector del SGC que también funciona en el celular (revisión móvil del
 * 2026-10-03; Nicolás, en su Android: «al intentar poner la prioridad no me
 * dejó, ese selector está dañado»).
 *
 * Causa: al tocar un Select de Mantine cerca del final de la página, el
 * navegador del celular desplaza la página para dejar el campo enfocado a la
 * vista (teclado virtual); el campo queda por un instante fuera de la
 * pantalla y Mantine esconde la lista (`hideDetached`). La lista se cierra
 * antes de poder elegir.
 *
 * - Con dedo (`pointer: coarse`) y lista sin búsqueda, o corta (hasta
 *   12 opciones, donde la búsqueda solo abre el teclado): se usa el selector
 *   NATIVO del sistema (el de Android/iOS), que no depende de posiciones ni
 *   del teclado. Mismo `data-testid`, etiqueta, descripción y valor.
 * - Con dedo y lista con búsqueda: el Select de Mantine sin `hideDetached`
 *   (la lista sigue al campo aunque la página se mueva) y con `flip`.
 * - Con ratón: el Select de siempre, idéntico al de SynerLink.
 */

/** Opciones del combobox para celular (MultiSelect, Autocomplete…): la lista no se esconde si la página se mueve. */
export function sgcTouchComboboxProps(extra?: ComboboxProps): ComboboxProps | undefined {
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) return extra;
  return { hideDetached: false, middlewares: { flip: true, shift: true }, ...extra };
}

/** Hasta cuántas opciones una lista con búsqueda se muestra con el selector nativo en el celular. */
const NATIVE_MAX_OPTIONS = 12;

type Item = { value: string; label: string; disabled?: boolean };

function flatItems(data: SelectProps['data']): Item[] {
  const out: Item[] = [];
  for (const d of data ?? []) {
    if (typeof d === 'string') out.push({ value: d, label: d });
    else if ('group' in d) for (const i of d.items) out.push(typeof i === 'string' ? { value: i, label: i } : { value: i.value, label: i.label, disabled: i.disabled });
    else out.push({ value: d.value, label: d.label, disabled: d.disabled });
  }
  return out;
}

export default function SgcSelect(props: SelectProps) {
  const coarse = useMediaQuery('(pointer: coarse)') ?? false;

  if (coarse && (!props.searchable || flatItems(props.data).length <= NATIVE_MAX_OPTIONS)) {
    const {
      data,
      value,
      defaultValue,
      onChange,
      placeholder,
      allowDeselect,
      clearable,
      required,
      /* Propiedades propias del combobox: no aplican al selector nativo. */
      searchable,
      nothingFoundMessage,
      comboboxProps,
      maxDropdownHeight,
      checkIconPosition,
      withCheckIcon,
      limit,
      filter,
      searchValue,
      defaultSearchValue,
      onSearchChange,
      onDropdownOpen,
      onDropdownClose,
      dropdownOpened,
      defaultDropdownOpened,
      hiddenInputProps,
      hiddenInputValuesDivider,
      withScrollArea,
      scrollAreaProps,
      renderOption,
      selectFirstOptionOnChange,
      autoSelectOnBlur,
      onClear,
      clearButtonProps,
      onOptionSubmit,
      openOnFocus,
      chevronColor,
      withAlignedLabels,
      rightSection,
      rightSectionPointerEvents,
      ...rest
    } = props as SelectProps & Record<string, unknown>;
    const items = flatItems(data);
    const canEmpty = allowDeselect !== false || clearable;
    const current = value === undefined ? undefined : (value ?? '');
    return (
      <NativeSelect
        {...(rest as NativeSelectProps)}
        required={required}
        value={current}
        defaultValue={current === undefined ? (defaultValue ?? '') : undefined}
        onChange={(e) => {
          const v = e.currentTarget.value;
          const item = items.find((i) => i.value === v);
          onChange?.(v === '' ? null : v, (item ?? { value: v, label: v }) as ComboboxItem);
        }}
        data={[{ value: '', label: placeholder ?? 'Seleccione…', disabled: !canEmpty && Boolean(current) }, ...items]}
      />
    );
  }

  return <Select {...props} comboboxProps={coarse ? { hideDetached: false, middlewares: { flip: true, shift: true }, ...props.comboboxProps } : props.comboboxProps} />;
}
