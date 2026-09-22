'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Ghost = { id: number; char: string; leaving: boolean };

const MIRROR_PROPS: (keyof CSSStyleDeclaration)[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textAlign',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
];

function splitToChars(text: string): string[] {
  // Array.from respeta pares subrogados (emoji) mejor que text.split('').
  return Array.from(text);
}

/**
 * Capa puramente decorativa sobre el `<textarea>` real del compositor: anima
 * la entrada/salida de cada carácter que se escribe o se borra AL FINAL del
 * mensaje (el caso normal de teclear), sin tocar el campo real — foco, cursor,
 * selección, IME, menciones, pegado y atajos de formato siguen funcionando
 * exactamente igual, porque nunca se deja de usar el `<textarea>` nativo.
 *
 * Solo se monta (y solo entonces `ChatComposer` le pone `color: transparent`
 * al texto real) cuando el propio compositor decidió que es seguro: sin
 * menciones abiertas, sin vista previa, mensaje corto y sin
 * `prefers-reduced-motion`. Cualquier cambio que no sea "se agregó/quitó algo
 * al final" (pegar en medio, aplicar negrita/cursiva, insertar una mención)
 * se redibuja completo SIN animar esa actualización puntual — nunca se
 * arriesga a mostrar un texto distinto al real.
 */
export default function ComposerLetterFx({
  textareaRef,
  value,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const prevValueRef = useRef(value);
  const nextId = useRef(0);
  const [ghosts, setGhosts] = useState<Ghost[]>(() => {
    const chars = splitToChars(value);
    nextId.current = chars.length;
    return chars.map((char, i) => ({ id: i, char, leaving: false }));
  });

  // Copia en vivo la tipografía/espaciado real del textarea al overlay para
  // que el espejo coincida pixel a pixel (mismo font, mismo padding, mismo
  // ajuste de línea). Se lee del propio nodo en cada actualización — nunca se
  // hardcodean valores — así que si el CSS del textarea cambia, el overlay lo
  // sigue solo.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    const cs = window.getComputedStyle(ta);
    for (const prop of MIRROR_PROPS) {
      const v = cs[prop];
      if (typeof v === 'string') {
        (ov.style as unknown as Record<string, string>)[prop as string] = v;
      }
    }
  });

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (prev === value) return;

    if (value.length > prev.length && value.startsWith(prev)) {
      // Se agregó texto al final — lo normal al teclear: solo se animan los
      // caracteres nuevos, el resto queda intacto.
      const added = splitToChars(value.slice(prev.length));
      setGhosts((g) => [
        ...g.filter((x) => !x.leaving),
        ...added.map((char) => ({ id: nextId.current++, char, leaving: false })),
      ]);
      return;
    }

    if (value.length < prev.length && prev.startsWith(value)) {
      // Se borró del final (Backspace/Supr sobre el último tramo): los
      // caracteres sobrantes se marcan "leaving" y se quitan solos cuando
      // termina su propia animación de salida (onAnimationEnd de cada span).
      setGhosts((g) => {
        const activos = g.filter((x) => !x.leaving);
        const cut = activos.length - value.length;
        if (cut <= 0) return g;
        return [
          ...activos.slice(0, activos.length - cut),
          ...activos.slice(activos.length - cut).map((x) => ({ ...x, leaving: true })),
          ...g.filter((x) => x.leaving),
        ];
      });
      return;
    }

    // Cualquier otro cambio (pegar en medio, cortar una selección, mención
    // insertada, formato aplicado, deshacer) no calza con "se agregó/quitó al
    // final" — se redibuja completo sin animar ESTA actualización puntual,
    // para no arriesgar un desfase visual.
    const chars = splitToChars(value);
    nextId.current = chars.length;
    setGhosts(chars.map((char, i) => ({ id: i, char, leaving: false })));
  }, [value]);

  return (
    <div ref={overlayRef} className='chat-composer__letterfx' aria-hidden='true'>
      {ghosts.map((g) => (
        <span
          key={g.id}
          className={`chat-composer__letterfx-char${g.leaving ? ' is-leaving' : ''}`}
          onAnimationEnd={() => {
            if (g.leaving) setGhosts((cur) => cur.filter((x) => x.id !== g.id));
          }}
        >
          {g.char}
        </span>
      ))}
    </div>
  );
}
