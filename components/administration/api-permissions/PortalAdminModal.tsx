'use client';

/**
 * «Administrar portal» de un proveedor o cliente (2026-11-09): SynerLink es la consola del portal
 * de proveedores (landing). Desde aquí se crean y desactivan sus usuarios (máximo 3 por NIT), se
 * restablece su contraseña, se vinculan empresas y se marcan los módulos que ve cada uno.
 * Cada cambio se guarda AL MOMENTO en la landing (no depende del «Guardar» del cliente de API).
 * Puente: /api/administration/api-clients/subjects/portal-terceros/admin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Divider,
  Group,
  Modal,
  Paper,
  Radio,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBuilding,
  IconCheck,
  IconCopy,
  IconKey,
  IconLink,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUserPlus,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';

const URL_ADMIN = '/api/administration/api-clients/subjects/portal-terceros/admin';
const TIPOS_DOCUMENTO = ['CC', 'NIT', 'CE', 'PASAPORTE'];

/* ─────────────────────────────── Tipos (respuesta de la landing) ─────────────────────────────── */

interface Vinculo {
  id: string;
  companyKey: string;
  companyName: string;
  cardCode: string;
  cardName: string | null;
  active: boolean;
  resources: string[];
}

interface Usuario {
  id: string;
  name: string | null;
  email: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  portalRole: string | null;
  active: boolean;
  mustChangePassword: boolean;
  bloqueado: boolean;
  lastLoginAt: string | null;
  vinculos: Vinculo[];
}

interface Catalogo {
  empresas: { clave: string; nombre: string }[];
  roles: { clave: string; nombre: string }[];
  modulos: Record<string, { area: string; modulos: { clave: string; nombre: string; descripcion: string }[] }[]>;
  sugeridos: Record<string, Record<string, string[]>>;
}

interface Vista extends Catalogo {
  nit: string;
  nombre: string | null;
  maxUsuarios: number;
  usuariosActivos: number;
  usuarios: Usuario[];
}

interface Socio {
  cardCode: string;
  cardName: string;
  nit: string;
  type: string;
  active: boolean;
}

type Post = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/* ─────────────────────────────── Modal ─────────────────────────────── */

export default function PortalAdminModal({
  opened,
  nit,
  nombre,
  onClose,
  onChanged,
}: {
  opened: boolean;
  nit: string;
  nombre: string | null;
  onClose: () => void;
  /** Tras cualquier cambio guardado (para refrescar el resumen del cliente y la lista). */
  onChanged: () => void;
}) {
  const isMobile = useMediaQuery('(max-width: 768px)', false);
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  /** Contraseña temporal recién generada: se muestra UNA vez. */
  const [password, setPassword] = useState<{ quien: string; usuario: string; valor: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${URL_ADMIN}?${new URLSearchParams({ nit }).toString()}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as (Vista & { error?: string }) | null;
      if (!res.ok || !body?.usuarios) throw new Error(body?.error || 'No se pudo consultar el portal');
      setVista(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo consultar el portal');
    } finally {
      setLoading(false);
    }
  }, [nit]);

  useEffect(() => {
    if (!opened) {
      setPassword(null);
      setNuevo(false);
      return;
    }
    void load();
  }, [opened, load]);

  const post: Post = useCallback(
    async (payload) => {
      const res = await fetch(URL_ADMIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nit, ...payload }),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'No se pudo completar el cambio');
      return body ?? {};
    },
    [nit]
  );

  /** Guarda, avisa, recarga la vista y el resumen. */
  const run = useCallback(
    async (payload: Record<string, unknown>, okMessage: string) => {
      const body = await post(payload);
      toast.success(okMessage);
      onChanged();
      await load();
      return body;
    },
    [post, onChanged, load]
  );

  const cupoLleno = vista ? vista.usuariosActivos >= vista.maxUsuarios : true;
  const titulo = vista?.nombre ?? nombre ?? `NIT ${nit}`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size='xl'
      centered
      fullScreen={isMobile}
      zIndex={360}
      title={
        <div>
          <Text fw={700}>Administrar portal de proveedores</Text>
          <Text size='sm' c='dimmed'>
            {titulo} · NIT {nit}
          </Text>
        </div>
      }
    >
      <Stack>
        <Text size='sm' c='dimmed'>
          Lo que cambies aquí se guarda al momento en el portal: qué usuarios del proveedor pueden entrar, a qué empresas de GSS
          y qué módulos ve cada uno. Todo en el portal es de solo lectura para el proveedor.
        </Text>

        {password && (
          <Alert color='green' icon={<IconKey size={18} />} title={`Contraseña temporal de ${password.quien}`} withCloseButton onClose={() => setPassword(null)}>
            <Stack gap={6}>
              <Group gap='xs'>
                <Code fz='md'>{password.valor}</Code>
                <CopyButton value={password.valor}>
                  {({ copied, copy }) => (
                    <Button size='xs' variant='light' color='green' leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                      {copied ? 'Copiada' : 'Copiar'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Text size='sm'>
                Cópiala ahora: no se volverá a mostrar. Su usuario de ingreso es <b>{password.usuario}</b> y deberá cambiar la
                contraseña la primera vez que entre.
              </Text>
            </Stack>
          </Alert>
        )}

        {error && (
          <Alert color='red' icon={<IconAlertCircle size={18} />} title='No se pudo cargar'>
            {error}
            <Button size='xs' variant='light' color='red' mt='xs' leftSection={<IconRefresh size={14} />} onClick={() => void load()}>
              Reintentar
            </Button>
          </Alert>
        )}

        {loading && !vista && <Skeleton height={220} radius='md' />}

        {vista && (
          <>
            <Group justify='space-between' align='center'>
              <Badge variant='light' size='lg' color={cupoLleno ? 'orange' : 'blue'}>
                {vista.usuariosActivos} de {vista.maxUsuarios} usuarios activos
              </Badge>
              <Button
                leftSection={<IconUserPlus size={16} />}
                onClick={() => setNuevo(true)}
                disabled={cupoLleno || nuevo}
                title={cupoLleno ? `Máximo ${vista.maxUsuarios} usuarios activos por proveedor: desactiva uno para crear otro` : undefined}
              >
                Nuevo usuario
              </Button>
            </Group>

            {nuevo && (
              <NewUserForm
                nit={nit}
                catalogo={vista}
                post={post}
                onCancel={() => setNuevo(false)}
                onCreated={(quien, usuario, valor) => {
                  setNuevo(false);
                  setPassword({ quien, usuario, valor });
                  toast.success('Usuario creado con los módulos sugeridos para su rol');
                  onChanged();
                  void load();
                }}
              />
            )}

            {vista.usuarios.length === 0 && !nuevo && (
              <Alert variant='light' icon={<IconAlertTriangle size={18} />}>
                Este proveedor todavía no tiene usuarios en el portal. Crea el primero con «Nuevo usuario».
              </Alert>
            )}

            {vista.usuarios.map((usuario) => (
              <UserCard
                key={usuario.id}
                usuario={usuario}
                nit={nit}
                catalogo={vista}
                post={post}
                run={run}
                onPassword={(valor) =>
                  setPassword({
                    quien: usuario.name ?? 'el usuario',
                    usuario: usuario.numeroDocumento ?? 'su documento',
                    valor,
                  })
                }
              />
            ))}
          </>
        )}
      </Stack>
    </Modal>
  );
}

/* ─────────────────────────────── Usuario ─────────────────────────────── */

function UserCard({
  usuario,
  nit,
  catalogo,
  post,
  run,
  onPassword,
}: {
  usuario: Usuario;
  nit: string;
  catalogo: Catalogo;
  post: Post;
  run: (payload: Record<string, unknown>, okMessage: string) => Promise<Record<string, unknown>>;
  onPassword: (valor: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [nombre, setNombre] = useState(usuario.name ?? '');
  const [email, setEmail] = useState(usuario.email ?? '');
  const [confirmReset, setConfirmReset] = useState(false);
  const [addLink, setAddLink] = useState(false);

  useEffect(() => {
    setNombre(usuario.name ?? '');
    setEmail(usuario.email ?? '');
  }, [usuario.name, usuario.email]);

  const datosCambiados = nombre.trim() !== (usuario.name ?? '') || email.trim() !== (usuario.email ?? '');

  const act = async (payload: Record<string, unknown>, okMessage: string) => {
    setBusy(true);
    try {
      await run({ userId: usuario.id, ...payload }, okMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const restablecer = async () => {
    setBusy(true);
    try {
      const body = await post({ action: 'restablecer-password', userId: usuario.id });
      if (typeof body.passwordTemporal === 'string') onPassword(body.passwordTemporal);
      setConfirmReset(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña');
    } finally {
      setBusy(false);
    }
  };

  const linked = new Set(usuario.vinculos.map((v) => v.companyKey));

  return (
    <Paper withBorder p='md' radius='md' style={{ opacity: usuario.active ? 1 : 0.75 }}>
      <Stack gap='sm'>
        <Group justify='space-between' align='flex-start' wrap='wrap'>
          <div style={{ minWidth: 0 }}>
            <Group gap='xs'>
              <Title order={5}>{usuario.name || 'Usuario sin nombre'}</Title>
              {!usuario.active && <Badge color='gray' variant='light'>Inactivo</Badge>}
              {usuario.bloqueado && (
                <Badge color='red' variant='light' leftSection={<IconLock size={12} />}>
                  Bloqueado
                </Badge>
              )}
              {usuario.mustChangePassword && <Badge color='yellow' variant='light'>Debe cambiar la contraseña</Badge>}
            </Group>
            <Text size='xs' c='dimmed'>
              Usuario de ingreso: {usuario.tipoDocumento ? `${usuario.tipoDocumento} ` : ''}
              {usuario.numeroDocumento ?? '—'}
              {usuario.lastLoginAt ? ` · Último ingreso: ${new Date(usuario.lastLoginAt).toLocaleString('es-CO')}` : ' · Nunca ha entrado'}
            </Text>
          </div>
          <Switch
            label={usuario.active ? 'Puede entrar' : 'No puede entrar'}
            checked={usuario.active}
            disabled={busy}
            onChange={(e) =>
              void act({ action: 'editar-usuario', active: e.currentTarget.checked }, e.currentTarget.checked ? 'Usuario activado' : 'Usuario desactivado')
            }
          />
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
          <TextInput label='Nombre' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={200} />
          <TextInput label='Correo (opcional)' value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={320} />
          <Select
            label='Rol en el portal'
            data={catalogo.roles.map((r) => ({ value: r.clave, label: r.nombre }))}
            value={usuario.portalRole}
            allowDeselect={false}
            disabled={busy}
            comboboxProps={{ withinPortal: true, zIndex: 400 }}
            onChange={(value) => value && value !== usuario.portalRole && void act({ action: 'editar-usuario', portalRole: value }, 'Rol actualizado')}
          />
        </SimpleGrid>

        <Group justify='space-between' wrap='wrap'>
          {confirmReset ? (
            <Group gap='xs'>
              <Text size='sm'>¿Generar una contraseña temporal nueva? La actual deja de servir.</Text>
              <Button size='xs' color='orange' loading={busy} onClick={() => void restablecer()}>
                Sí, restablecer
              </Button>
              <Button size='xs' variant='default' onClick={() => setConfirmReset(false)}>
                Cancelar
              </Button>
            </Group>
          ) : (
            <Button size='xs' variant='subtle' leftSection={<IconKey size={14} />} onClick={() => setConfirmReset(true)}>
              Restablecer contraseña
            </Button>
          )}
          <Button
            size='xs'
            disabled={!datosCambiados}
            loading={busy}
            onClick={() => void act({ action: 'editar-usuario', nombre: nombre.trim(), email: email.trim() }, 'Datos guardados')}
          >
            Guardar datos
          </Button>
        </Group>

        <Divider label='Empresas y módulos que ve' labelPosition='left' />

        {usuario.vinculos.map((vinculo) => (
          <LinkEditor
            key={vinculo.id}
            vinculo={vinculo}
            portalRole={usuario.portalRole}
            catalogo={catalogo}
            soloUno={usuario.vinculos.length === 1}
            onSave={(payload, okMessage) => run({ userId: usuario.id, linkId: vinculo.id, ...payload }, okMessage)}
          />
        ))}

        {addLink ? (
          <PartnerPicker
            nit={nit}
            catalogo={catalogo}
            excluded={linked}
            post={post}
            submitLabel='Vincular empresa'
            onCancel={() => setAddLink(false)}
            onSubmit={async (company, cardCode) => {
              await run({ action: 'vincular', userId: usuario.id, company, cardCode }, 'Empresa vinculada con los módulos sugeridos');
              setAddLink(false);
            }}
          />
        ) : (
          linked.size < catalogo.empresas.length && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} style={{ alignSelf: 'flex-start' }} onClick={() => setAddLink(true)}>
              Agregar empresa
            </Button>
          )
        )}
      </Stack>
    </Paper>
  );
}

/* ─────────────────────────────── Vínculo (empresa + módulos) ─────────────────────────────── */

function LinkEditor({
  vinculo,
  portalRole,
  catalogo,
  soloUno,
  onSave,
}: {
  vinculo: Vinculo;
  portalRole: string | null;
  catalogo: Catalogo;
  soloUno: boolean;
  onSave: (payload: Record<string, unknown>, okMessage: string) => Promise<unknown>;
}) {
  const areas = catalogo.modulos[vinculo.companyKey] ?? [];
  const todos = useMemo(() => areas.flatMap((a) => a.modulos.map((m) => m.clave)), [areas]);
  const sugeridos = (portalRole && catalogo.sugeridos[portalRole]?.[vinculo.companyKey]) || [];
  const rolNombre = catalogo.roles.find((r) => r.clave === portalRole)?.nombre;
  const [resources, setResources] = useState(vinculo.resources);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setResources(vinculo.resources), [vinculo.resources]);
  const dirty = resources.length !== vinculo.resources.length || resources.some((r) => !vinculo.resources.includes(r));

  const save = async (payload: Record<string, unknown>, okMessage: string) => {
    setBusy(true);
    try {
      await onSave(payload, okMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p='sm' radius='md' bg='var(--mantine-color-default-hover)'>
      <Stack gap='xs'>
        <Group justify='space-between' wrap='wrap'>
          <Group gap='xs'>
            <IconBuilding size={16} />
            <Text fw={600}>{vinculo.companyName}</Text>
            <Text size='xs' c='dimmed'>
              Código SAP {vinculo.cardCode}
            </Text>
            <Badge size='sm' variant='light' color={vinculo.resources.length ? 'blue' : 'orange'}>
              {vinculo.resources.length} {vinculo.resources.length === 1 ? 'módulo' : 'módulos'}
            </Badge>
          </Group>
          <Group gap='xs'>
            <Switch
              size='sm'
              label={vinculo.active ? 'Activa' : 'Inactiva'}
              checked={vinculo.active}
              disabled={busy}
              onChange={(e) =>
                void save({ action: 'editar-vinculo', active: e.currentTarget.checked }, e.currentTarget.checked ? 'Empresa activada' : 'Empresa desactivada')
              }
            />
            {!soloUno &&
              (confirmDelete ? (
                <Group gap={4}>
                  <Button size='compact-xs' color='red' loading={busy} onClick={() => void save({ action: 'desvincular' }, 'Empresa quitada')}>
                    Sí, quitar
                  </Button>
                  <Button size='compact-xs' variant='default' onClick={() => setConfirmDelete(false)}>
                    No
                  </Button>
                </Group>
              ) : (
                <Button size='compact-xs' variant='subtle' color='red' leftSection={<IconTrash size={12} />} onClick={() => setConfirmDelete(true)}>
                  Quitar
                </Button>
              ))}
          </Group>
        </Group>

        <Checkbox.Group value={resources} onChange={setResources}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            {areas.map((area) => (
              <Stack key={area.area} gap={4}>
                <Text size='sm' fw={600}>
                  {area.area}
                </Text>
                {area.modulos.map((m) => (
                  <Checkbox key={m.clave} value={m.clave} label={m.nombre} description={m.descripcion} disabled={busy} />
                ))}
              </Stack>
            ))}
          </SimpleGrid>
        </Checkbox.Group>

        <Group justify='space-between' wrap='wrap'>
          <Group gap={4}>
            {sugeridos.length > 0 && rolNombre && (
              <Button size='compact-xs' variant='subtle' onClick={() => setResources(sugeridos)}>
                Sugeridos para {rolNombre}
              </Button>
            )}
            <Button size='compact-xs' variant='subtle' onClick={() => setResources(todos)}>
              Marcar todo
            </Button>
            <Button size='compact-xs' variant='subtle' onClick={() => setResources([])}>
              Quitar todo
            </Button>
          </Group>
          <Button size='xs' disabled={!dirty} loading={busy} onClick={() => void save({ action: 'editar-vinculo', resources }, 'Módulos guardados')}>
            Guardar módulos
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/* ─────────────────────────────── Elegir empresa y socio de SAP ─────────────────────────────── */

function PartnerPicker({
  nit,
  catalogo,
  excluded,
  post,
  submitLabel,
  onCancel,
  onSubmit,
  hideActions = false,
  onChoose,
}: {
  nit: string;
  catalogo: Catalogo;
  excluded?: Set<string>;
  post: Post;
  submitLabel?: string;
  onCancel?: () => void;
  onSubmit?: (company: string, cardCode: string) => Promise<void>;
  /** Dentro de otro formulario: solo informa la elección. */
  hideActions?: boolean;
  onChoose?: (choice: { company: string; cardCode: string } | null) => void;
}) {
  const [company, setCompany] = useState<string | null>(null);
  const [socios, setSocios] = useState<Socio[] | null>(null);
  const [cardCode, setCardCode] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = catalogo.empresas.filter((e) => !excluded?.has(e.clave)).map((e) => ({ value: e.clave, label: e.nombre }));

  const choose = (code: string | null, comp = company) => {
    setCardCode(code);
    onChoose?.(comp && code ? { company: comp, cardCode: code } : null);
  };

  const buscar = async (comp: string) => {
    setSearching(true);
    setError(null);
    setSocios(null);
    choose(null, comp);
    try {
      const body = await post({ action: 'buscar-socios', company: comp });
      const items = Array.isArray(body.items) ? (body.items as Socio[]) : [];
      setSocios(items);
      if (items.length === 1) choose(items[0].cardCode, comp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar en SAP');
    } finally {
      setSearching(false);
    }
  };

  return (
    <Stack gap='xs'>
      <Select
        label='Empresa de GSS'
        placeholder='Elige la empresa'
        data={options}
        value={company}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true, zIndex: 400 }}
        onChange={(value) => {
          setCompany(value);
          if (value) void buscar(value);
        }}
      />
      {searching && (
        <Text size='sm' c='dimmed'>
          <IconSearch size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Buscando el NIT {nit} en SAP…
        </Text>
      )}
      {error && (
        <Alert color='red' icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}
      {socios && socios.length === 0 && (
        <Text size='sm' c='dimmed'>
          El NIT {nit} no existe en SAP en esa empresa. Elige otra.
        </Text>
      )}
      {socios && socios.length > 0 && (
        <Radio.Group value={cardCode} onChange={(value) => choose(value)} label='Socio de negocio en SAP'>
          <Stack gap={6} mt={4}>
            {socios.map((s) => (
              <Radio
                key={s.cardCode}
                value={s.cardCode}
                label={`${s.cardName || s.cardCode} · ${s.type === 'PROVEEDOR' ? 'Proveedor' : s.type === 'CLIENTE' ? 'Cliente' : 'Otro'}${s.active ? '' : ' · inactivo en SAP'}`}
                description={`Código ${s.cardCode}`}
              />
            ))}
          </Stack>
        </Radio.Group>
      )}
      {!hideActions && (
        <Group justify='flex-end' gap='xs'>
          <Button variant='default' size='xs' onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            size='xs'
            leftSection={<IconLink size={14} />}
            disabled={!company || !cardCode}
            loading={saving}
            onClick={async () => {
              if (!company || !cardCode || !onSubmit) return;
              setSaving(true);
              try {
                await onSubmit(company, cardCode);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'No se pudo vincular');
              } finally {
                setSaving(false);
              }
            }}
          >
            {submitLabel}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

/* ─────────────────────────────── Nuevo usuario ─────────────────────────────── */

function NewUserForm({
  nit,
  catalogo,
  post,
  onCancel,
  onCreated,
}: {
  nit: string;
  catalogo: Catalogo;
  post: Post;
  onCancel: () => void;
  onCreated: (quien: string, usuario: string, password: string) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<string | null>('CC');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [portalRole, setPortalRole] = useState<string | null>(null);
  const [socio, setSocio] = useState<{ company: string; cardCode: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documento = numeroDocumento.replace(/\D/g, '');
  const listo = nombre.trim() && documento.length >= 5 && portalRole && socio;

  const crear = async () => {
    if (!listo || !socio || !portalRole) return;
    setSaving(true);
    setError(null);
    try {
      const body = await post({
        action: 'crear-usuario',
        nombre: nombre.trim(),
        tipoDocumento: tipoDocumento ?? 'CC',
        numeroDocumento: documento,
        email: email.trim(),
        portalRole,
        company: socio.company,
        cardCode: socio.cardCode,
      });
      onCreated(nombre.trim(), documento, typeof body.passwordTemporal === 'string' ? body.passwordTemporal : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper withBorder p='md' radius='md'>
      <Stack gap='sm'>
        <Title order={5}>Nuevo usuario del proveedor</Title>
        {error && (
          <Alert color='red' icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
          <TextInput label='Nombre' required value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={200} />
          <TextInput label='Correo (opcional)' value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={320} />
          <Select
            label='Tipo de documento'
            data={TIPOS_DOCUMENTO}
            value={tipoDocumento}
            allowDeselect={false}
            onChange={setTipoDocumento}
            comboboxProps={{ withinPortal: true, zIndex: 400 }}
          />
          <TextInput
            label='Número de documento'
            description='Es su usuario para entrar al portal (solo números, sin dígito de verificación).'
            required
            value={numeroDocumento}
            onChange={(e) => setNumeroDocumento(e.currentTarget.value)}
            maxLength={30}
          />
          <Select
            label='Rol en el portal'
            description='Define qué módulos se marcan solos; luego puedes ajustarlos.'
            required
            placeholder='Elige el rol'
            data={catalogo.roles.map((r) => ({ value: r.clave, label: r.nombre }))}
            value={portalRole}
            onChange={setPortalRole}
            comboboxProps={{ withinPortal: true, zIndex: 400 }}
          />
        </SimpleGrid>
        <PartnerPicker nit={nit} catalogo={catalogo} post={post} hideActions onChoose={setSocio} />
        <Text size='xs' c='dimmed'>
          Se crea con una contraseña temporal que verás una sola vez. El usuario la cambia al entrar por primera vez.
        </Text>
        <Group justify='flex-end' gap='xs'>
          <Button variant='default' onClick={onCancel}>
            Cancelar
          </Button>
          <Button leftSection={<IconUserPlus size={16} />} disabled={!listo} loading={saving} onClick={() => void crear()}>
            Crear usuario
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
