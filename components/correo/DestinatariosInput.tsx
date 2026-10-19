'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Group, TagsInput, Text } from '@mantine/core';
import { IconBuilding, IconClock } from '@tabler/icons-react';
import { esExterno, normalizarDestinatario, separarDestinatarios } from '../../lib/correo/destinatarios';
import { correoApi, esCancelada, type SugerenciaDestinatario } from './correoClient';
import { AvatarPersona } from './ui';

/**
 * Campo de destinatarios de Redactar (Para, CC o CCO), como Gmail: cada dirección es una «píldora»; al escribir
 * sugiere primero a las personas a las que usted les escribió hace poco y luego el directorio de la organización
 * (solo nombre y correo). Acepta lo que se pega desde Outlook («Nombre <correo>; …»). Lo que no es un correo no
 * entra: queda escrito con el aviso en rojo para corregirlo. Los externos se marcan en amarillo.
 */
export interface DestinatariosInputProps {
  etiqueta: string;
  value: string[];
  onChange: (v: string[]) => void;
  dominiosGrupo: string[];
  disabled?: boolean;
  autoFocus?: boolean;
  testId: string;
  /** Enlaces «CC» / «CCO» a la derecha del campo Para. */
  derecha?: React.ReactNode;
}

export default function DestinatariosInput({ etiqueta, value, onChange, dominiosGrupo, disabled, autoFocus, testId, derecha }: DestinatariosInputProps) {
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<SugerenciaDestinatario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enfocado, setEnfocado] = useState(false);
  const pegado = useRef<string | null>(null);
  const nombres = useRef(new Map<string, SugerenciaDestinatario>());

  // Consulta con una pausa corta mientras se escribe; la anterior se cancela.
  useEffect(() => {
    if (!enfocado || disabled) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      correoApi
        .destinatarios(busqueda.trim(), ctrl.signal)
        .then((r) => {
          for (const s of r.destinatarios) nombres.current.set(s.correo, s);
          setSugerencias(r.destinatarios);
        })
        .catch((e) => {
          if (!esCancelada(e)) setSugerencias([]);
        });
    }, busqueda.trim() ? 200 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [busqueda, enfocado, disabled]);

  const data = useMemo(() => {
    const ya = new Set(value);
    // La etiqueta ES el correo (TagsInput guarda la etiqueta de la opción elegida); el nombre se pinta en renderOption.
    return sugerencias.filter((s) => !ya.has(s.correo)).map((s) => ({ value: s.correo, label: s.correo }));
  }, [sugerencias, value]);

  const cambiar = (nuevos: string[]) => {
    // Pegado: se usa el texto completo (los nombres con coma de Outlook no se parten mal).
    const piezas = pegado.current !== null ? [...value, ...separarDestinatarios(pegado.current)] : nuevos.flatMap((x) => (value.includes(x) ? [x] : separarDestinatarios(x)));
    pegado.current = null;
    const validos: string[] = [];
    const invalidos: string[] = [];
    for (const p of piezas) {
      const c = normalizarDestinatario(p);
      if (!c) invalidos.push(p);
      else if (!validos.includes(c)) validos.push(c);
    }
    onChange(validos);
    if (invalidos.length) {
      setError(`${invalidos.length === 1 ? 'No es un correo válido' : 'No son correos válidos'}: ${invalidos.slice(0, 3).join(', ')}`);
      // Diferido: TagsInput limpia la búsqueda justo después de llamar a onChange.
      const resto = invalidos.join(', ');
      setTimeout(() => setBusqueda(resto), 0);
    } else setError(null);
  };

  const externos = value.filter((c) => esExterno(c, dominiosGrupo));

  return (
    <div data-testid={testId}>
      <Group wrap='nowrap' gap={6} align='flex-start'>
        <Text size='sm' c='dimmed' w={34} pt={7} style={{ flexShrink: 0 }}>
          {etiqueta}
        </Text>
        <TagsInput
          aria-label={`Destinatarios: ${etiqueta}`}
          variant='unstyled'
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          onChange={cambiar}
          searchValue={busqueda}
          onSearchChange={setBusqueda}
          onPaste={(e) => {
            pegado.current = `${busqueda} ${e.clipboardData.getData('text/plain')}`;
          }}
          onFocus={() => setEnfocado(true)}
          onBlur={() => setEnfocado(false)}
          data={data}
          filter={({ options }) => options}
          splitChars={[',', ';', ' ']}
          acceptValueOnBlur
          disabled={disabled}
          autoFocus={autoFocus}
          maxDropdownHeight={280}
          comboboxProps={{ withinPortal: true, zIndex: 400 }}
          renderOption={({ option }) => {
            const s = nombres.current.get(option.value);
            return (
              <Group gap='sm' wrap='nowrap' data-testid='correo-sugerencia'>
                <AvatarPersona nombre={s?.nombre ?? option.value} correo={option.value} size={30} />
                <div style={{ minWidth: 0 }}>
                  <Text size='sm' truncate>
                    {s?.nombre && s.nombre !== option.value ? s.nombre : option.value}
                  </Text>
                  {s?.nombre && s.nombre !== option.value && (
                    <Text size='xs' c='dimmed' truncate>
                      {option.value}
                    </Text>
                  )}
                </div>
                {s && (
                  <Badge size='xs' variant='light' color={s.origen === 'reciente' ? 'gray' : 'blue'} leftSection={s.origen === 'reciente' ? <IconClock size={10} /> : <IconBuilding size={10} />} style={{ flexShrink: 0, marginLeft: 'auto' }}>
                    {s.origen === 'reciente' ? 'Reciente' : 'Directorio'}
                  </Badge>
                )}
              </Group>
            );
          }}
          styles={{
            input: { minHeight: 34, paddingInline: 0 },
            pill: { textTransform: 'none' },
          }}
          data-testid={`${testId}-input`}
        />
        {derecha}
      </Group>
      {error && (
        <Text size='xs' c='red.7' pl={40} data-testid={`${testId}-error`}>
          {error}
        </Text>
      )}
      {externos.length > 0 && (
        <Text size='xs' c='yellow.8' pl={40} data-testid={`${testId}-externos`}>
          Fuera del grupo: {externos.join(', ')}
        </Text>
      )}
    </div>
  );
}
