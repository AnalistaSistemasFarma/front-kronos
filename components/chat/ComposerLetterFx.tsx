'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Ghost = { id: number; char: string; leaving: boolean };

/*
 * Lo que se copia del textarea al espejo. Además de la tipografía básica van
 * las propiedades que cambian el ANCHO de cada letra sin cambiar la letra
 * (kerning, ligaduras, rasgos OpenType, ancho de fuente, render) y las que
 * deciden dónde se parte el renglón: si alguna difiere, el texto dibujado se
 * corre respecto al real y el cursor nativo —que es del textarea— queda
 * "separado" o "metido" en la letra (Nicolás, 2026-09-29).
 *
 * Los BORDES ya no se copian: el espejo se coloca sobre la caja interior del
 * textarea (ver `sincronizarCaja`), así que no lleva borde propio.
 */
const MIRROR_PROPS: (keyof CSSStyleDeclaration)[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'fontKerning',
  'fontVariantLigatures',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontOpticalSizing',
  'textRendering',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textAlign',
  'textIndent',
  'textTransform',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
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

  /**
   * Calca el espejo sobre el textarea: tipografía, relleno, CAJA y
   * desplazamiento.
   *
   * La caja es la interior del textarea (`clientLeft/Top/Width/Height`), no la
   * del contenedor: así el espejo excluye el borde y la barra de
   * desplazamiento (que en escritorio le quita ancho al renglón real) y no
   * depende de que el textarea llene exactamente el contenedor.
   *
   * El DESPLAZAMIENTO también se copia: pasado `maxRows` el textarea se
   * desplaza por dentro y antes el espejo se quedaba quieto, mostrando otros
   * renglones que los del cursor.
   */
  const sincronizarCaja = useCallback(() => {
    const ta = textareaRef.current;
    const ov = overlayRef.current;
    const padre = ov?.parentElement;
    if (!ta || !ov || !padre) return;
    const cs = window.getComputedStyle(ta);
    const estilo = ov.style as unknown as Record<string, string>;
    for (const prop of MIRROR_PROPS) {
      const v = cs[prop];
      if (typeof v === 'string') estilo[prop as string] = v;
    }
    const rTa = ta.getBoundingClientRect();
    const rPadre = padre.getBoundingClientRect();
    ov.style.borderWidth = '0px';
    ov.style.right = 'auto';
    ov.style.bottom = 'auto';
    ov.style.top = `${rTa.top - rPadre.top - padre.clientTop + ta.clientTop}px`;
    ov.style.left = `${rTa.left - rPadre.left - padre.clientLeft + ta.clientLeft}px`;
    ov.style.width = `${ta.clientWidth}px`;
    ov.style.height = `${ta.clientHeight}px`;
    ov.scrollTop = ta.scrollTop;
  }, [textareaRef]);

  // En cada actualización (cada tecla): el autosize del textarea pudo cambiar
  // su alto y su desplazamiento en este mismo cuadro.
  useLayoutEffect(() => {
    sincronizarCaja();
  });

  // Y fuera de las teclas: el textarea que se desplaza con el dedo o la rueda,
  // y el que cambia de tamaño sin que cambie el texto (girar el celular,
  // abrir el panel lateral).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.addEventListener('scroll', sincronizarCaja, { passive: true });
    const observador =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => sincronizarCaja()) : null;
    observador?.observe(ta);
    return () => {
      ta.removeEventListener('scroll', sincronizarCaja);
      observador?.disconnect();
    };
  }, [textareaRef, sincronizarCaja]);

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
      // Los saltos de línea (`\n`) son la excepción: se renderizan como <br>
      // (ver `Letra`) para forzar un salto real en el flujo, y un <br> no
      // dispara `onAnimationEnd` — se quitan de inmediato, sin animar salida.
      setGhosts((g) => {
        const activos = g.filter((x) => !x.leaving);
        const cut = activos.length - value.length;
        if (cut <= 0) return g;
        const cortados = activos.slice(activos.length - cut);
        return [
          ...activos.slice(0, activos.length - cut),
          ...cortados.filter((x) => x.char !== '\n').map((x) => ({ ...x, leaving: true })),
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

  const quitarLetra = useCallback((id: number) => {
    setGhosts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  // Las letras van PLANAS, una detrás de otra, como `display: inline` (ver
  // `.chat-composer__letterfx-char` en globals.css): el renglón se parte con
  // las mismas reglas que el textarea real y ya no hace falta agruparlas por
  // palabra.
  return (
    <div ref={overlayRef} className='chat-composer__letterfx' aria-hidden='true'>
      {ghosts.map((g) => (
        <Letra key={g.id} ghost={g} onSalida={quitarLetra} />
      ))}
    </div>
  );
}

/**
 * Una letra del espejo. En `memo`: al teclear solo se monta la letra nueva; las
 * cientos que ya estaban no se vuelven a renderizar en cada tecla.
 */
const Letra = memo(function Letra({
  ghost,
  onSalida,
}: {
  ghost: Ghost;
  onSalida: (id: number) => void;
}) {
  if (ghost.char === '\n') {
    // El salto de línea se pinta como <br>: un <br> no dispara
    // `onAnimationEnd`, por eso los `\n` se quitan sin animar su salida (ver
    // el efecto de arriba).
    return <br />;
  }
  return (
    <span
      className={`chat-composer__letterfx-char${ghost.leaving ? ' is-leaving' : ''}`}
      onAnimationEnd={() => {
        if (ghost.leaving) onSalida(ghost.id);
      }}
    >
      {ghost.char}
    </span>
  );
});
