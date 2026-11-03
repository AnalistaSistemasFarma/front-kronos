'use client';

import { IconSearch, IconX } from '@tabler/icons-react';
import { useRef, useState, type ReactNode } from 'react';
import classes from './IosSearchField.module.css';

/**
 * Buscador estilo iOS / macOS para los listados: cápsula gris, lupa, X para borrar y
 * "Cancelar" (borra y suelta el foco). Escape también limpia.
 */
export default function IosSearchField({
  value,
  onChange,
  placeholder = 'Buscar',
  meta,
  ariaLabel = 'Buscar',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Línea pequeña debajo (p. ej. "3 de 40 resultados"). */
  meta?: ReactNode;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const hasText = value.length > 0;

  const cancel = () => {
    onChange('');
    inputRef.current?.blur();
  };

  return (
    <div>
      <div
        className={classes.root}
        data-focused={focused || undefined}
        data-active={focused || hasText || undefined}
      >
        <label className={classes.field}>
          <span className={classes.glyph} aria-hidden>
            <IconSearch size={16} stroke={2.2} />
          </span>
          <input
            ref={inputRef}
            className={classes.input}
            type='search'
            enterKeyHint='search'
            autoComplete='off'
            spellCheck={false}
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
            }}
          />
          {hasText ? (
            <button
              type='button'
              className={classes.clear}
              aria-label='Borrar búsqueda'
              // Sin perder el foco del campo al tocar la X.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
            >
              <IconX size={11} stroke={3} />
            </button>
          ) : null}
        </label>
        <button
          type='button'
          className={classes.cancel}
          tabIndex={focused || hasText ? 0 : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
        >
          Cancelar
        </button>
      </div>
      {meta ? <div className={classes.meta}>{meta}</div> : null}
    </div>
  );
}
