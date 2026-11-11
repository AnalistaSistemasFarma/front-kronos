'use client';

/**
 * Modal de un cliente «Proveedor / cliente»: lo que ese NIT ve HOY en el portal de proveedores
 * (por empresa → usuario → módulos), con el botón «Administrar portal» (PortalAdminModal), desde
 * donde SynerLink crea usuarios, vincula empresas y marca módulos (2026-11-09: SynerLink es la
 * consola del portal; la landing solo lo muestra). Es distinto de «Tienen permiso en», que es lo
 * que la llave de API puede hacer en SynerLink.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Skeleton } from '@mantine/core';
import { IconAlertTriangle, IconBuilding, IconRefresh, IconSettings, IconUser } from '@tabler/icons-react';
import { panelStyles as ps } from '@/components/ui/panel/Panel';
import { InsetGroup, TonePill } from './InsetList';
import PortalAdminModal from './PortalAdminModal';
import s from './apiPermissions.module.css';
import { loadPortalAccess, portalAccessSummary, type PortalAccessState } from './portalAccess';

const LABEL = 'Lo que ve cada usuario, por empresa';
const FOOTER =
  'Para crear usuarios, vincular empresas o cambiar módulos usa «Administrar portal». No hace falta «Guardar»: los cambios quedan al momento.';
/** Módulos visibles por usuario antes de «+N más» (hay usuarios con 17 y se pierde la vista). */
const CHIPS_PREVIEW = 6;

export default function PortalAccessSection({
  nit,
  nombre,
  onChanged,
}: {
  nit: string | null;
  nombre?: string | null;
  /** Tras guardar algo en el portal (refresca el resumen de la lista). */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<PortalAccessState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  /** Usuarios con todos sus módulos a la vista (clave empresa:usuario). */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const changed = useCallback(() => {
    setAttempt((n) => n + 1);
    onChanged?.();
  }, [onChanged]);

  useEffect(() => {
    if (!nit) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadPortalAccess([nit], controller.signal)
      .then(setState)
      .catch(() => {
        /* cancelada: llegó otro NIT o se cerró el modal */
      });
    return () => controller.abort();
  }, [nit, attempt]);

  if (!nit) {
    return (
      <InsetGroup label={LABEL} footer={FOOTER}>
        <div className={ps.empty}>Elige el proveedor o cliente para ver y administrar lo que tiene en el portal.</div>
      </InsetGroup>
    );
  }

  let trailing: ReactNode = null;
  let content: ReactNode;
  const canAdmin = state?.status !== 'not_configured';

  if (!state || state.status === 'loading') {
    trailing = 'Consultando…';
    content = (
      <div className={s.rowStack} style={{ borderTop: 0 }}>
        <Skeleton height={14} width='50%' radius='xl' />
        <Skeleton height={22} radius='xl' />
      </div>
    );
  } else if (state.status !== 'ok') {
    content = (
      <div className={s.rowStack} style={{ borderTop: 0 }}>
        <TonePill tone='warning' icon={<IconAlertTriangle size={12} />}>
          {state.message}
        </TonePill>
        <button type='button' className={`${s.addButton} ${s.press}`} onClick={retry} style={{ justifySelf: 'start' }}>
          <IconRefresh size={14} />
          Reintentar
        </button>
      </div>
    );
  } else {
    const access = state.items[nit];
    if (!access || access.empresas.length === 0) {
      trailing = 'Sin acceso';
      content = (
        <div className={ps.empty}>
          Este NIT no tiene usuarios activos en el portal, así que hoy no ve nada. Créale usuarios con «Administrar
          portal».
        </div>
      );
    } else {
      trailing = portalAccessSummary(access);
      content = access.empresas.map((empresa, i) => (
        <div
          key={`${empresa.clave}-${empresa.cardCode ?? i}`}
          className={s.rowStack}
          style={i === 0 ? { borderTop: 0 } : undefined}
        >
          <span className={s.portalCompany}>
            <IconBuilding size={16} aria-hidden />
            <span className={s.pickTitle}>{empresa.nombre}</span>
            {empresa.cardCode && <span className={s.pickSub}>Código SAP {empresa.cardCode}</span>}
          </span>
          {empresa.usuarios.map((usuario, j) => {
            const userKey = `${empresa.clave}-${empresa.cardCode ?? i}:${j}`;
            const showAll = expanded.has(userKey) || usuario.modulos.length <= CHIPS_PREVIEW + 1;
            const visible = showAll ? usuario.modulos : usuario.modulos.slice(0, CHIPS_PREVIEW);
            return (
              <div key={j} className={s.portalUser}>
                <span className={s.pickSub}>
                  <IconUser
                    size={12}
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      verticalAlign: '-1px',
                      marginRight: 4,
                    }}
                  />
                  <strong className={s.metricStrong}>{usuario.nombre}</strong>
                  {usuario.rol ? ` · ${usuario.rol}` : ''} · {usuario.modulos.length}{' '}
                  {usuario.modulos.length === 1 ? 'módulo' : 'módulos'}
                </span>
                {usuario.modulos.length === 0 ? (
                  <span className={s.rowHint}>No tiene módulos marcados: entra al portal pero no ve información.</span>
                ) : (
                  <span className={s.portalChips}>
                    {visible.map((m) => (
                      <span key={m.clave} className={s.chip} title={m.area}>
                        {m.nombre}
                      </span>
                    ))}
                    {usuario.modulos.length > CHIPS_PREVIEW + 1 && (
                      <button
                        type='button'
                        className={s.linkAction}
                        onClick={() => toggleExpanded(userKey)}
                        aria-expanded={expanded.has(userKey)}
                      >
                        {expanded.has(userKey) ? 'Ver menos' : `+${usuario.modulos.length - CHIPS_PREVIEW} más`}
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ));
    }
  }

  return (
    <>
      <InsetGroup label={LABEL} trailing={trailing} footer={FOOTER}>
        {content}
        {canAdmin && (
          <div className={s.rowStack}>
            <button
              type='button'
              className={`${s.addButton} ${s.press}`}
              onClick={() => setAdminOpen(true)}
              style={{ justifySelf: 'start' }}
            >
              <IconSettings size={14} />
              Administrar portal
            </button>
          </div>
        )}
      </InsetGroup>
      <PortalAdminModal
        opened={adminOpen}
        nit={nit}
        nombre={nombre ?? null}
        onClose={() => setAdminOpen(false)}
        onChanged={changed}
      />
    </>
  );
}
