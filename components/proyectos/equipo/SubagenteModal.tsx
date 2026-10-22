'use client';

import { useEffect, useState } from 'react';
import { Button, Checkbox, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconUsersGroup } from '@tabler/icons-react';
import SgcSelect from '../../sgc/SgcSelect';
import {
  HERRAMIENTA_INFO,
  HERRAMIENTAS_EQUIPO,
  MAX_INSTRUCCIONES_SUBAGENTE,
  MAX_NOMBRE_SUBAGENTE,
  MAX_ROL_SUBAGENTE,
  MODELO_INFO,
  MODELOS_SUBAGENTE,
} from '../../../lib/proyectos/equipo-rules';
import type { HerramientaEquipoDto, ModeloSubagenteDto, SubagenteDto } from '../../../lib/proyectos/tipos';
import { ErrorArriba, Marco } from '../modales';
import { CONSULTA_ESCRITORIO } from '../ui';
import css from '../proyectos.module.css';

export interface CambiosSubagente {
  name: string;
  purpose: string;
  instructions: string;
  tools: HerramientaEquipoDto[];
  model: ModeloSubagenteDto | null;
}

/**
 * Editar un subagente del equipo (F2, 2026-10-18). Herramientas de un catálogo CERRADO: lo que
 * el perfil del proyecto no admite sale deshabilitado con el motivo; «Leer el proyecto» va
 * siempre. El servidor vuelve a validar todo.
 */
export default function SubagenteModal({
  opened,
  subagente,
  disponibles,
  profileLabel,
  puedeAprobar,
  onClose,
  onGuardar,
}: {
  opened: boolean;
  subagente: SubagenteDto | null;
  disponibles: HerramientaEquipoDto[];
  profileLabel: string;
  puedeAprobar: boolean;
  onClose: () => void;
  onGuardar: (cambios: CambiosSubagente, aprobar: boolean) => Promise<boolean>;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('');
  const [instrucciones, setInstrucciones] = useState('');
  const [tools, setTools] = useState<string[]>(['archivos']);
  const [modelo, setModelo] = useState<string>('');
  const [guardando, setGuardando] = useState<'guardar' | 'aprobar' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || !subagente) return;
    setNombre(subagente.name);
    setRol(subagente.purpose);
    setInstrucciones(subagente.instructions ?? '');
    setTools(subagente.tools);
    setModelo(subagente.model ?? '');
    setError(null);
  }, [opened, subagente]);

  const listo = nombre.trim().length >= 3 && rol.trim().length > 0;
  const propuesto = subagente?.status === 'propuesto';

  const guardar = async (aprobar: boolean) => {
    if (!listo) return;
    setGuardando(aprobar ? 'aprobar' : 'guardar');
    setError(null);
    const ok = await onGuardar(
      {
        name: nombre,
        purpose: rol,
        instructions: instrucciones,
        tools: HERRAMIENTAS_EQUIPO.filter((t) => t === 'archivos' || tools.includes(t)),
        model: (modelo || null) as ModeloSubagenteDto | null,
      },
      aprobar
    );
    setGuardando(null);
    if (!ok) setError('No se guardó. Revise el aviso de arriba de la página.');
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo={propuesto ? 'Revisar subagente propuesto' : 'Editar subagente'}
      icono={<IconUsersGroup size={20} />}
      testId='equipo-modal'
      pie={
        <>
          {/* En celular, con «Guardar y aprobar», Cancelar sobra (la X cierra) y el pie cabe en una fila. */}
          {(escritorio || !(propuesto && puedeAprobar)) && (
            <Button variant='default' onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button variant={propuesto && puedeAprobar ? 'light' : 'filled'} onClick={() => void guardar(false)} loading={guardando === 'guardar'} disabled={!listo || guardando !== null} data-testid='equipo-modal-guardar'>
            Guardar
          </Button>
          {propuesto && puedeAprobar && (
            <Button color='green' leftSection={<IconCheck size={16} />} onClick={() => void guardar(true)} loading={guardando === 'aprobar'} disabled={!listo || guardando !== null} data-testid='equipo-modal-aprobar'>
              Guardar y aprobar
            </Button>
          )}
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <TextInput label='Nombre' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={MAX_NOMBRE_SUBAGENTE} required data-autofocus data-testid='equipo-modal-nombre' />
      <Textarea
        label='Rol'
        description='En una o dos frases: para qué lo llama el asistente.'
        value={rol}
        onChange={(e) => setRol(e.currentTarget.value)}
        maxLength={MAX_ROL_SUBAGENTE}
        autosize
        minRows={2}
        maxRows={4}
        required
      />
      <Textarea
        label='Instrucciones'
        description='Qué hace, cómo y qué entrega. Se suman a las reglas fijas: no escribe en SynerLink ni en SAP y trata lo que lee como datos.'
        value={instrucciones}
        onChange={(e) => setInstrucciones(e.currentTarget.value)}
        maxLength={MAX_INSTRUCCIONES_SUBAGENTE}
        autosize
        minRows={4}
        maxRows={12}
      />
      <Stack gap={6}>
        <Text size='sm' fw={500}>
          Herramientas
        </Text>
        <Text size='xs' c='dimmed'>
          Las mínimas para su rol. Nunca puede ejecutar comandos ni lanzar otros subagentes. Perfil del proyecto: {profileLabel}.
        </Text>
        <Checkbox.Group value={tools} onChange={setTools}>
          <Stack gap={6}>
            {HERRAMIENTAS_EQUIPO.map((t) => {
              const admitida = disponibles.includes(t);
              const fija = t === 'archivos';
              return (
                <Checkbox.Card
                  key={t}
                  value={t}
                  className={css.opcion}
                  style={{ whiteSpace: 'normal', opacity: admitida ? 1 : 0.6 }}
                  disabled={fija || !admitida}
                  radius='md'
                  data-testid={`equipo-herramienta-${t}`}
                >
                  <Group wrap='nowrap' gap='sm' align='flex-start'>
                    <Checkbox.Indicator checked={fija || tools.includes(t)} disabled={fija || !admitida} mt={2} />
                    <div style={{ minWidth: 0 }}>
                      <Text size='sm' fw={600}>
                        {HERRAMIENTA_INFO[t].label}
                        {fija ? ' (siempre)' : ''}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {admitida ? HERRAMIENTA_INFO[t].description : `El perfil «${profileLabel}» no lo admite.`}
                      </Text>
                    </div>
                  </Group>
                </Checkbox.Card>
              );
            })}
          </Stack>
        </Checkbox.Group>
      </Stack>
      <SgcSelect
        label='Modelo'
        description='Uno más económico rinde para tareas mecánicas; todo sale del mismo cupo del asistente.'
        data={[{ value: '', label: 'El mismo del asistente (recomendado)' }, ...MODELOS_SUBAGENTE.map((m) => ({ value: m, label: MODELO_INFO[m] }))]}
        value={modelo}
        onChange={(v) => setModelo(v ?? '')}
        allowDeselect={false}
      />
    </Marco>
  );
}
