'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Divider, Group, Modal, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconFolderPlus, IconInfoCircle, IconShieldLock } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import AgentAvatar from '../chat/AgentAvatar';
import { apiGet, apiSend } from './api';
import { CONSULTA_ESCRITORIO } from './ui';
import {
  MAX_PROJECT_AGENTS,
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  MAX_PROJECT_NAME_CHARS,
} from '../../lib/chat/projects-rules';
import type { ListaProyectosDto } from '../../lib/proyectos/tipos';
import type { OpcionesPermisosDto } from '../../lib/proyectos/permisos-agentes-tipos';
import { MAX_MOTIVO, MIN_MOTIVO } from '../../lib/proyectos/permisos-agentes-rules';
import FormPermisosAgentes, { BadgeNivel, PERMISOS_POR_DEFECTO, permisosListos, type ValorPermisos } from './permisos/FormPermisosAgentes';
import css from './proyectos.module.css';

/**
 * «Nuevo proyecto». La empresa decide qué asistentes se pueden designar (los
 * que la persona tiene en esa empresa y con el módulo habilitado) y el perfil
 * de conectores debe ser uno que admitan TODOS los asistentes escogidos. El
 * servidor vuelve a validar todo; esto solo evita ofrecer lo que no va a pasar.
 */
export default function NuevoProyectoModal({
  opened,
  datos,
  onClose,
  onCreado,
}: {
  opened: boolean;
  datos: ListaProyectosDto;
  onClose: () => void;
  onCreado: (idProject: number, equipoPedido: boolean) => void;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [nombre, setNombre] = useState('');
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [agentes, setAgentes] = useState<string[]>([]);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [instrucciones, setInstrucciones] = useState('');
  // Equipo de subagentes (F2, 2026-10-18): «de primeras», el asistente propone un equipo al crear.
  const [sugerirEquipo, setSugerirEquipo] = useState(true);
  // Permisos de los agentes (2026-10-20): valor seguro por defecto, «ninguno» y sin repos.
  const [opcionesPermisos, setOpcionesPermisos] = useState<OpcionesPermisosDto | null>(null);
  const [permisos, setPermisos] = useState<ValorPermisos>(PERMISOS_POR_DEFECTO);
  const [motivoPermisos, setMotivoPermisos] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir: la primera empresa con asistentes, y el formulario en blanco.
  useEffect(() => {
    if (!opened) return;
    const primera = datos.companies.find((c) => (datos.designables[String(c.idCompany)] ?? []).length > 0);
    setNombre('');
    setDescripcion('');
    setInstrucciones('');
    setSugerirEquipo(true);
    setPermisos(PERMISOS_POR_DEFECTO);
    setMotivoPermisos('');
    setError(null);
    setEmpresa(primera ? String(primera.idCompany) : null);
  }, [opened, datos]);

  const designables = useMemo(() => (empresa ? datos.designables[empresa] ?? [] : []), [datos, empresa]);

  // Quién puede escoger los permisos y en qué empresas (la reja real está en el servidor).
  useEffect(() => {
    if (!opened) return;
    const ctrl = new AbortController();
    void apiGet<OpcionesPermisosDto>('/api/proyectos/permisos-agentes', '', ctrl.signal).then((r) => {
      if (r.ok) setOpcionesPermisos(r.data);
    });
    return () => ctrl.abort();
  }, [opened]);
  const puedeEscogerPermisos = empresa !== null && (opcionesPermisos?.editableCompanies ?? []).includes(Number(empresa));
  // Otra empresa, otros permisos: se vuelve al valor seguro.
  useEffect(() => {
    setPermisos(PERMISOS_POR_DEFECTO);
    setMotivoPermisos('');
  }, [empresa]);
  const conCodigo = puedeEscogerPermisos && permisos.codeLevel !== 'ninguno';
  const permisosOk = !puedeEscogerPermisos || (permisosListos(permisos) && (!conCodigo || motivoPermisos.trim().length >= MIN_MOTIVO));

  // Al cambiar de empresa se reinicia la elección: un asistente de otra empresa no sirve.
  useEffect(() => {
    setAgentes(designables.length === 1 ? [designables[0].code] : []);
  }, [designables]);

  const perfilesComunes = useMemo(() => {
    const elegidos = designables.filter((a) => agentes.includes(a.code));
    if (elegidos.length === 0) return [];
    return datos.profiles.filter((p) => elegidos.every((a) => a.profiles.includes(p.key)));
  }, [datos.profiles, designables, agentes]);

  useEffect(() => {
    setPerfil((actual) => (actual && perfilesComunes.some((p) => p.key === actual) ? actual : perfilesComunes[0]?.key ?? null));
  }, [perfilesComunes]);

  const listo = nombre.trim().length > 0 && empresa !== null && agentes.length > 0 && perfil !== null && permisosOk;

  const crear = async () => {
    if (!listo || !empresa || !perfil) return;
    setEnviando(true);
    setError(null);
    const r = await apiSend<{ idProject: number; teamRequested?: boolean }>(
      'POST',
      '/api/proyectos',
      {
        name: nombre,
        idCompany: Number(empresa),
        description: descripcion,
        agentCodes: agentes,
        profile: perfil,
        instructions: instrucciones,
        suggestTeam: sugerirEquipo,
        // Solo quien puede escogerlos los envía; los demás quedan en «ninguno».
        ...(puedeEscogerPermisos ? { agentPolicy: { ...permisos, reason: conCodigo ? motivoPermisos : undefined } } : {}),
      },
      'No se pudo crear el proyecto.'
    );
    setEnviando(false);
    if (r.ok && r.data.idProject) onCreado(r.data.idProject, r.data.teamRequested === true);
    else if (!r.ok) setError(r.error);
  };

  const perfilElegido = datos.profiles.find((p) => p.key === perfil);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={!escritorio}
      size='lg'
      radius='md'
      centered
      classNames={{ content: css.modalTactil }}
      closeButtonProps={{ size: escritorio ? 'md' : 'xl', 'aria-label': 'Cerrar' }}
      title={
        <Group gap={8}>
          <IconFolderPlus size={20} />
          <Text fw={700}>Nuevo proyecto</Text>
        </Group>
      }
      data-testid='proyectos-modal-nuevo'
    >
      <Stack gap='md'>
        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <TextInput
          label='Nombre'
          placeholder='Ej.: Comex Latam — Importaciones 2026'
          value={nombre}
          onChange={(e) => setNombre(e.currentTarget.value)}
          maxLength={MAX_PROJECT_NAME_CHARS}
          required
          data-autofocus
        />
        <SgcSelect
          label='Empresa'
          description='Solo los miembros con el permiso «Proyectos» en esta empresa podrán entrar.'
          data={datos.companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
          value={empresa}
          onChange={setEmpresa}
          allowDeselect={false}
          required
        />
        <Textarea
          label='Descripción'
          description='Una o dos líneas: de qué se trata. La ven todos los miembros.'
          value={descripcion}
          onChange={(e) => setDescripcion(e.currentTarget.value)}
          maxLength={MAX_PROJECT_DESCRIPTION_CHARS}
          autosize
          minRows={2}
          maxRows={4}
        />
        <Stack gap={6}>
          <Text size='sm' fw={500}>
            Asistentes del proyecto <span style={{ color: 'var(--mantine-color-error)' }}>*</span>
          </Text>
          <Text size='xs' c='dimmed'>
            Puede escoger hasta {MAX_PROJECT_AGENTS}. Cada conversación usa la cuenta y el plan de su asistente.
          </Text>
          {designables.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No tiene asistentes con proyectos habilitados en esta empresa.
            </Text>
          ) : (
            <Checkbox.Group value={agentes} onChange={setAgentes}>
              <Stack gap={6}>
                {designables.map((a) => (
                  <Checkbox.Card key={a.code} value={a.code} className={css.opcion} data-checked={agentes.includes(a.code) ? 'true' : 'false'} radius='md'>
                    <Group wrap='nowrap' gap='sm'>
                      <Checkbox.Indicator />
                      <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={30} showStatus={false} withTooltip={false} />
                      <div style={{ minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1}>
                          {a.displayName}
                        </Text>
                        {a.handle && (
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {a.handle}
                          </Text>
                        )}
                      </div>
                    </Group>
                  </Checkbox.Card>
                ))}
              </Stack>
            </Checkbox.Group>
          )}
        </Stack>
        <SgcSelect
          label='Conectores (perfil)'
          description={perfilElegido?.description ?? 'Escoja primero los asistentes: solo se ofrecen los perfiles que admiten todos.'}
          data={perfilesComunes.map((p) => ({ value: p.key, label: p.label }))}
          value={perfil}
          onChange={setPerfil}
          allowDeselect={false}
          disabled={perfilesComunes.length === 0}
          required
        />
        <Textarea
          label='Instrucciones para los asistentes'
          description='Qué papel cumplen aquí y de qué temas se ocupan. Las leen en cada respuesta del proyecto.'
          value={instrucciones}
          onChange={(e) => setInstrucciones(e.currentTarget.value)}
          maxLength={MAX_PROJECT_INSTRUCTIONS_CHARS}
          autosize
          minRows={3}
          maxRows={8}
        />
        <Checkbox
          checked={sugerirEquipo}
          onChange={(e) => setSugerirEquipo(e.currentTarget.checked)}
          label='Pedir al asistente que sugiera un equipo de subagentes'
          description='Propondrá de 3 a 6 especialistas para las actividades del proyecto. Usted los aprueba, edita o descarta en la sección «Equipo»; nada trabaja sin su aprobación.'
          data-testid='proyectos-sugerir-equipo'
        />
        <Divider my={4} />
        <Stack gap='sm' data-testid='proyectos-permisos-agentes'>
          <Group gap={8}>
            <IconShieldLock size={18} />
            <Text fw={600} size='sm'>
              Permisos de los agentes
            </Text>
          </Group>
          {puedeEscogerPermisos && opcionesPermisos ? (
            <>
              <FormPermisosAgentes valor={permisos} onChange={setPermisos} catalogo={opcionesPermisos.catalog} operadores={opcionesPermisos.operators} />
              {conCodigo && (
                <Textarea
                  label='Motivo'
                  description='Por qué los agentes de este proyecto necesitan este acceso. Queda en el registro de cambios.'
                  value={motivoPermisos}
                  onChange={(e) => setMotivoPermisos(e.currentTarget.value)}
                  maxLength={MAX_MOTIVO}
                  autosize
                  minRows={2}
                  maxRows={4}
                  required
                  data-testid='proyectos-permisos-motivo'
                />
              )}
            </>
          ) : (
            <Alert color='gray' radius='md' icon={<IconInfoCircle size={18} />} py={8} data-testid='proyectos-permisos-solo-lectura'>
              <Group gap={8} wrap='wrap' mb={4}>
                <BadgeNivel nivel='ninguno' />
                <Text size='sm'>Solo conversación e información del proyecto.</Text>
              </Group>
              <Text size='xs' c='dimmed'>
                El acceso a código lo da la administración de SynerLink o quien tenga el permiso «Permisos de agentes en Proyectos» en esta empresa. Se puede
                cambiar después, en la sección «Permisos» del proyecto.
              </Text>
            </Alert>
          )}
        </Stack>
        <Group justify='flex-end' gap='sm' className={escritorio ? undefined : css.pieModal}>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void crear()} loading={enviando} disabled={!listo} data-testid='proyectos-crear'>
            Crear proyecto
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
