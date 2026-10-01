'use client';

import { useCallback } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import './sgc-row-link.css';

/**
 * Filas de tabla que se comportan como un enlace: clic abre la vista interna,
 * ctrl/cmd + clic o clic medio la abren en otra pestaña, y con teclado se
 * entra con Enter o Espacio. Los botones, enlaces, menús y casillas que haya
 * dentro de la fila hacen lo suyo sin disparar la navegación de la fila.
 */

const INTERACTIVE =
  'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="option"],[role="combobox"],[data-row-ignore]';

/**
 * true si la fila NO debe navegar: el evento nació en un control interactivo
 * dentro de la fila, o fuera de su DOM (un modal en portal también burbujea
 * por React hasta la fila).
 */
export function fromInteractiveChild(target: EventTarget | null, row: EventTarget | null): boolean {
  if (!target || !row || typeof (target as Element).closest !== 'function') return false;
  if (!(row as Element).contains(target as Node)) return true;
  const hit = (target as Element).closest(INTERACTIVE);
  return !!hit && hit !== row && (row as Element).contains(hit);
}

export interface SgcRowLinkOptions {
  /** Acción del clic normal cuando no se quiere navegar (p. ej. abrir un detalle). */
  onOpen?: () => void;
}

export interface SgcRowLinkProps {
  role: 'link';
  tabIndex: 0;
  className: string;
  'data-href'?: string;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  onAuxClick: (e: MouseEvent<HTMLElement>) => void;
  onMouseDown: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useSgcRowLink() {
  const router = useRouter();
  return useCallback(
    (href: string | null | undefined, options: SgcRowLinkOptions = {}): SgcRowLinkProps | Record<string, never> => {
      if (!href && !options.onOpen) return {};
      const newTab = () => {
        if (href) window.open(href, '_blank', 'noopener');
        else options.onOpen?.();
      };
      const open = () => {
        if (options.onOpen) options.onOpen();
        else if (href) router.push(href);
      };
      return {
        role: 'link',
        tabIndex: 0,
        className: 'sgc-row-link',
        ...(href ? { 'data-href': href } : {}),
        onClick: (e) => {
          if (fromInteractiveChild(e.target, e.currentTarget)) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) newTab();
          else open();
        },
        onAuxClick: (e) => {
          if (e.button !== 1 || fromInteractiveChild(e.target, e.currentTarget)) return;
          e.preventDefault();
          newTab();
        },
        // Evita el autodesplazamiento del clic medio para que abra la pestaña.
        onMouseDown: (e) => {
          if (e.button === 1 && !fromInteractiveChild(e.target, e.currentTarget)) e.preventDefault();
        },
        onKeyDown: (e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) newTab();
            else open();
          }
        },
      };
    },
    [router]
  );
}
