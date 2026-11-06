'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Button, Checkbox, Divider, Grid, Group, Loader, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconBuilding, IconCheck, IconFilter, IconFlag, IconPaperclip, IconTicket, IconUser } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import SgcSelect, { sgcTouchComboboxProps } from '../sgc/SgcSelect';
import { correoApi, tamano, urlTicket, type PreparacionTicket, type ResultadoTicket } from './correoClient';

/**
 * «Crear ticket» desde un hilo del Correo — solo TI (técnicos de la mesa de ayuda). Los MISMOS
 * campos y etiquetas del formulario «Crear Nuevo Caso» del tablero de tickets
 * (/process/help-desk/create-ticket), precargados con el correo: asunto («Remitente - asunto»),
 * descripción, solicitante por el remitente (si es usuario de SynerLink), técnico (la persona)
 * y los adjuntos del hilo. El resultado se muestra ARRIBA, con color, y además con un aviso.
 */

type Opcion = { value: string; label: string };
type Resultado = { color: 'green' | 'yellow' | 'red'; titulo: string; texto: string; idCase?: number } | null;

export interface CrearTicketModalProps {
  opened: boolean;
  conversationId: string;
  /** Al cerrar: idCase si se creó (la ficha del hilo lo muestra sin recargar). */
  onClose: (idCase: number | null) => void;
}

const opciones = (xs: Array<{ id: number; nombre: string }>): Opcion[] => xs.map((x) => ({ value: String(x.id), label: x.nombre }));

function SolicitanteTicket({ empresa, valor, inicial, onChange }: { empresa: number | null; valor: string | null; inicial: Opcion | null; onChange: (v: string | null) => void }) {
  const [opts, setOpts] = useState<Opcion[]>(inicial ? [inicial] : []);
  const [busqueda, setBusqueda] = useState('');
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (!empresa || busqueda.trim().length < 2) return;
    t.current = setTimeout(() => {
      correoApi
        .usuarios(empresa, busqueda)
        .then((r) =>
          setOpts((prev) => {
            const m = new Map(prev.map((o) => [o.value, o]));
            for (const u of r.usuarios) m.set(u.id, { value: u.id, label: `${u.nombre} (${u.correo})` });
            return [...m.values()];
          })
        )
        .catch(() => undefined);
    }, 300);
  }, [busqueda, empresa]);
  return (
    <Select
      label='Solicitante'
      placeholder='Buscar usuario…'
      description='Sin solicitante, el ticket queda a su nombre con el remitente como contacto'
      searchable
      clearable
      data={opts}
      value={valor}
      onSearchChange={setBusqueda}
      onChange={onChange}
      nothingFoundMessage={busqueda.length < 2 ? 'Escriba al menos 2 letras' : 'Sin resultados'}
      leftSection={<IconUser size={16} />}
      comboboxProps={sgcTouchComboboxProps({ withinPortal: true })}
      disabled={!empresa}
      data-testid='correo-ticket-solicitante'
    />
  );
}

export default function CrearTicketModal({ opened, conversationId, onClose }: CrearTicketModalProps) {
  const desktop = useMediaQuery('(min-width: 48em)') ?? true;
  const [prep, setPrep] = useState<PreparacionTicket | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [creando, setCreando] = useState(false);
  const [creado, setCreado] = useState<number | null>(null);
  const [subcategorias, setSubcategorias] = useState<Opcion[]>([]);
  const [actividades, setActividades] = useState<Opcion[]>([]);
  const [f, setF] = useState({
    tipo: '',
    prioridad: '',
    empresa: '',
    sitio: '',
    asunto: '',
    categoria: '',
    subcategoria: '',
    actividad: '',
    departamento: '',
    tecnico: '',
    solicitante: null as string | null,
    descripcion: '',
  });
  const [adjuntos, setAdjuntos] = useState<string[]>([]);
  const arriba = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    let vivo = true;
    setCargando(true);
    setErrorCarga(null);
    correoApi
      .prepararTicket(conversationId)
      .then((p) => {
        if (!vivo) return;
        setPrep(p);
        setF((x) => ({
          ...x,
          empresa: p.idCompany ? String(p.idCompany) : '',
          asunto: p.asunto,
          descripcion: p.descripcion,
          tecnico: p.idTecnico ? String(p.idTecnico) : '',
          solicitante: p.solicitante && p.idCompany && p.solicitante.empresas.includes(p.idCompany) ? p.solicitante.id : null,
        }));
        setAdjuntos(p.adjuntos.map((a) => a.id));
        if (p.ticketExistente) {
          setCreado(p.ticketExistente);
          setResultado({ color: 'yellow', titulo: `Este hilo ya tiene el ticket #${p.ticketExistente}`, texto: 'No se crea otro ticket desde el mismo hilo.', idCase: p.ticketExistente });
        }
      })
      .catch((e) => vivo && setErrorCarga(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [opened, conversationId]);

  // Cascada Categoría → Subcategoría → Actividad: los mismos catálogos del formulario de la mesa de ayuda.
  useEffect(() => {
    setSubcategorias([]);
    if (!f.categoria) return;
    fetch(`/api/help-desk/subcategories?category_id=${encodeURIComponent(f.categoria)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((xs: Array<{ id_subcategory: number; subcategory: string }>) => setSubcategorias(xs.map((x) => ({ value: String(x.id_subcategory), label: x.subcategory }))))
      .catch(() => setSubcategorias([]));
  }, [f.categoria]);
  useEffect(() => {
    setActividades([]);
    if (!f.subcategoria) return;
    fetch(`/api/help-desk/activities?subcategory_id=${encodeURIComponent(f.subcategoria)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((xs: Array<{ id_activity: number; activity: string }>) => setActividades(xs.map((x) => ({ value: String(x.id_activity), label: x.activity }))))
      .catch(() => setActividades([]));
  }, [f.subcategoria]);

  const set = (campo: keyof typeof f, v: string | null) =>
    setF((x) => ({
      ...x,
      [campo]: campo === 'solicitante' ? v : v ?? '',
      ...(campo === 'categoria' ? { subcategoria: '', actividad: '' } : {}),
      ...(campo === 'subcategoria' ? { actividad: '' } : {}),
      // El solicitante es de una empresa: al cambiarla se vuelve a elegir (salvo que también pertenezca a la nueva).
      ...(campo === 'empresa' && !(prep?.solicitante && v && prep.solicitante.empresas.includes(Number(v)) && x.solicitante === prep.solicitante.id) ? { solicitante: null } : {}),
    }));

  const faltan = [
    !f.tipo && 'tipo de solicitud',
    !f.prioridad && 'prioridad',
    !f.empresa && 'empresa',
    !f.sitio && 'sitio',
    f.asunto.trim().length < 3 && 'asunto',
    !f.categoria && 'categoría',
    !f.subcategoria && 'subcategoría',
    !f.actividad && 'actividad',
    !f.departamento && 'departamento',
    f.descripcion.trim().length < 10 && 'descripción (mínimo 10 caracteres)',
  ].filter(Boolean) as string[];

  const crear = async () => {
    if (!prep || faltan.length) return;
    setCreando(true);
    setResultado(null);
    try {
      const r: ResultadoTicket = await correoApi.crearTicket({
        conversationId,
        idCompany: Number(f.empresa),
        idSolicitante: f.solicitante,
        tipo: f.tipo,
        prioridad: f.prioridad,
        sitio: f.sitio,
        categoria: Number(f.categoria),
        subcategoria: Number(f.subcategoria),
        actividad: Number(f.actividad),
        departamento: Number(f.departamento),
        tecnico: f.tecnico ? Number(f.tecnico) : null,
        asunto: f.asunto,
        descripcion: f.descripcion,
        adjuntosIds: adjuntos,
      });
      setCreado(r.idCase);
      const conFallas = r.adjuntosFallidos.length > 0;
      setResultado({
        color: conFallas ? 'yellow' : 'green',
        titulo: `Ticket #${r.idCase} creado`,
        texto: `Solicitante: ${r.solicitante}. Adjuntos copiados: ${r.adjuntosSubidos} de ${adjuntos.length}.${conFallas ? ` No se copiaron: ${r.adjuntosFallidos.join('; ')}.` : ''}`,
        idCase: r.idCase,
      });
      if (conFallas) toast(`Ticket #${r.idCase} creado, pero algunos adjuntos no se copiaron.`, { icon: '⚠️' });
      else toast.success(`Ticket #${r.idCase} creado.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResultado({ color: 'red', titulo: 'No se pudo crear el ticket', texto: msg });
      toast.error(msg);
    } finally {
      setCreando(false);
      arriba.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  const solicitanteInicial = prep?.solicitante ? { value: prep.solicitante.id, label: `${prep.solicitante.nombre} (${prep.remitente.correo})` } : null;

  return (
    <Modal
      opened={opened}
      onClose={() => onClose(creado)}
      title={
        <Group gap='xs'>
          <IconTicket size={20} />
          <Text size='lg' fw={600}>
            Crear ticket desde el correo
          </Text>
        </Group>
      }
      size='xl'
      radius='md'
      fullScreen={!desktop}
      overlayProps={{ blur: 4 }}
      data-testid='correo-ticket-modal'
    >
      <div ref={arriba} />
      {resultado && (
        <Alert
          color={resultado.color}
          icon={resultado.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
          title={resultado.titulo}
          mb='md'
          data-testid='correo-ticket-resultado'
        >
          <Text size='sm'>{resultado.texto}</Text>
          {resultado.idCase && (
            <Anchor href={urlTicket(resultado.idCase)} size='sm' fw={600}>
              Abrir el ticket #{resultado.idCase}
            </Anchor>
          )}
        </Alert>
      )}
      {cargando ? (
        <Group justify='center' py='xl'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Leyendo el correo…
          </Text>
        </Group>
      ) : errorCarga ? (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo preparar el ticket' data-testid='correo-ticket-error'>
          {errorCarga}
        </Alert>
      ) : prep && !creado ? (
        <Stack>
          <Text size='sm' c='dimmed'>
            Correo de <b>{prep.remitente.nombre || prep.remitente.correo}</b> &lt;{prep.remitente.correo}&gt;
            {prep.solicitante ? '' : ' — no es usuario de SynerLink: quedará como correo de contacto del ticket.'}
          </Text>
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Tipo de Solicitud'
                placeholder='Seleccione el tipo de solicitud'
                data={prep.tipos}
                value={f.tipo || null}
                onChange={(v) => set('tipo', v)}
                required
                leftSection={<IconTicket size={16} />}
                data-testid='correo-ticket-tipo'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Prioridad'
                placeholder='Seleccione la prioridad'
                data={prep.prioridades}
                value={f.prioridad || null}
                onChange={(v) => set('prioridad', v)}
                required
                leftSection={<IconFlag size={16} />}
                data-testid='correo-ticket-prioridad'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Empresa Solicitante'
                placeholder='Seleccione la empresa'
                data={prep.empresas.map((e) => ({ value: String(e.idCompany), label: e.companyName }))}
                value={f.empresa || null}
                onChange={(v) => set('empresa', v)}
                required
                leftSection={<IconBuilding size={16} />}
                data-testid='correo-ticket-empresa'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Sitio'
                placeholder='Seleccione el sitio'
                data={prep.sitios}
                value={f.sitio || null}
                onChange={(v) => set('sitio', v)}
                required
                leftSection={<IconBuilding size={16} />}
                data-testid='correo-ticket-sitio'
              />
            </Grid.Col>
          </Grid>

          <TextInput
            label='Asunto'
            value={f.asunto}
            onChange={(e) => set('asunto', e.currentTarget.value)}
            required
            maxLength={200}
            description='«Solicitante - asunto», como los casos que llegan por correo'
            data-testid='correo-ticket-asunto'
          />

          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Categoría'
                placeholder='Seleccione la categoría'
                data={opciones(prep.categorias)}
                value={f.categoria || null}
                onChange={(v) => set('categoria', v)}
                required
                searchable
                leftSection={<IconFilter size={16} />}
                data-testid='correo-ticket-categoria'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Subcategoría'
                placeholder='Seleccione la subcategoría'
                data={subcategorias}
                value={f.subcategoria || null}
                onChange={(v) => set('subcategoria', v)}
                required
                searchable
                disabled={!f.categoria}
                leftSection={<IconFilter size={16} />}
                data-testid='correo-ticket-subcategoria'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Actividad'
                placeholder='Seleccione la actividad'
                data={actividades}
                value={f.actividad || null}
                onChange={(v) => set('actividad', v)}
                required
                searchable
                disabled={!f.subcategoria}
                leftSection={<IconFilter size={16} />}
                data-testid='correo-ticket-actividad'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Departamento'
                placeholder='Seleccione el departamento'
                data={opciones(prep.departamentos)}
                value={f.departamento || null}
                onChange={(v) => set('departamento', v)}
                required
                searchable
                leftSection={<IconBuilding size={16} />}
                data-testid='correo-ticket-departamento'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Técnico Asignado'
                placeholder='Seleccione el técnico (opcional)'
                description='Puede dejarse sin asignar'
                data={opciones(prep.tecnicos)}
                value={f.tecnico || null}
                onChange={(v) => set('tecnico', v)}
                clearable
                searchable
                leftSection={<IconUser size={16} />}
                data-testid='correo-ticket-tecnico'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SolicitanteTicket
                key={f.empresa}
                empresa={f.empresa ? Number(f.empresa) : null}
                valor={f.solicitante}
                inicial={solicitanteInicial}
                onChange={(v) => set('solicitante', v)}
              />
            </Grid.Col>
          </Grid>

          <Textarea
            label='Descripción Detallada'
            value={f.descripcion}
            onChange={(e) => set('descripcion', e.currentTarget.value)}
            required
            minRows={5}
            maxLength={1000}
            autosize
            description='Mínimo 10 caracteres, máximo 1000 caracteres'
            data-testid='correo-ticket-descripcion'
          />

          {prep.adjuntos.length > 0 && (
            <Stack gap={4} data-testid='correo-ticket-adjuntos'>
              <Text size='sm' fw={500}>
                <IconPaperclip size={14} style={{ verticalAlign: 'middle' }} /> Adjuntos del correo que se copian al ticket
              </Text>
              {prep.adjuntos.map((a) => (
                <Checkbox
                  key={a.id}
                  size='xs'
                  label={`${a.nombre} (${tamano(a.tamano)})`}
                  checked={adjuntos.includes(a.id)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setAdjuntos((xs) => (on ? [...xs, a.id] : xs.filter((x) => x !== a.id)));
                  }}
                />
              ))}
            </Stack>
          )}

          <Divider />
          {faltan.length > 0 && (
            <Text size='xs' c='dimmed' data-testid='correo-ticket-faltan'>
              Falta: {faltan.join(', ')}.
            </Text>
          )}
          <Group justify='flex-end' gap='md'>
            <Button variant='outline' onClick={() => onClose(creado)} size='md'>
              Cancelar
            </Button>
            <Button onClick={crear} loading={creando} disabled={faltan.length > 0} size='md' leftSection={<IconTicket size={16} />} data-testid='correo-ticket-crear'>
              Crear ticket
            </Button>
          </Group>
        </Stack>
      ) : creado ? (
        <Group justify='flex-end'>
          <Button onClick={() => onClose(creado)} data-testid='correo-ticket-cerrar'>
            Cerrar
          </Button>
        </Group>
      ) : null}
    </Modal>
  );
}
