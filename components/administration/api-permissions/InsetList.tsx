'use client';

/**
 * Piezas tipo Ajustes de iOS/macOS para «Permisos API»: grupo «inset» (etiqueta
 * gris arriba, tarjeta redondeada con filas y nota al pie), ícono por tipo de
 * cliente y hoja de acción para confirmar (en lugar de confirmaciones en línea).
 */
import type { CSSProperties, ReactNode } from 'react';
import { Loader, Modal, Switch } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconApi, IconBuildingStore, IconPlugConnected, IconRobot, IconWorld } from '@tabler/icons-react';
import { panelStyles as ps, seriesColor, toneClass, type StatusTone } from '@/components/ui/panel/Panel';
import type { ApiClientType } from '@/lib/api-permissions/constants';
import s from './apiPermissions.module.css';

/* ─────────────────────────────── Tipos de cliente ─────────────────────────────── */

const TYPE_ICONS: Record<ApiClientType, typeof IconApi> = {
  agente: IconRobot,
  mexico: IconWorld,
  portal_terceros: IconBuildingStore,
  synerlink: IconPlugConnected,
  otro: IconApi,
};

/** Índice de la paleta categórica de Panel (validada para daltonismo); null = gris. */
const TYPE_SERIES: Record<ApiClientType, number | null> = {
  agente: 6,
  mexico: 1,
  portal_terceros: 0,
  synerlink: 2,
  otro: null,
};

export function typeColor(type: ApiClientType, isDark: boolean): string {
  const index = TYPE_SERIES[type];
  return index === null ? 'var(--pn-idle)' : seriesColor(index, isDark);
}

export function TypeIcon({
  type,
  isDark,
  size = 18,
  className,
}: {
  type: ApiClientType;
  isDark: boolean;
  size?: number;
  className?: string;
}) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={`${s.typeIcon} ${className ?? ''}`}
      style={{ '--type-color': typeColor(type, isDark) } as CSSProperties}
      aria-hidden
    >
      <Icon size={size} stroke={1.8} />
    </span>
  );
}

/* ─────────────────────────────── Grupo «inset» ─────────────────────────────── */

export function InsetGroup({
  label,
  trailing,
  footer,
  footerTone,
  footerIcon,
  bare = false,
  children,
}: {
  label?: string;
  trailing?: ReactNode;
  footer?: ReactNode;
  /** Nota al pie con tono (p. ej. error): se pinta con ícono + texto. */
  footerTone?: StatusTone;
  footerIcon?: ReactNode;
  /** Sin tarjeta (el contenido ya trae las suyas). */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={s.group}>
      {label || trailing ? (
        <div className={s.groupHead}>
          {label ? <span className={s.groupLabel}>{label}</span> : <span />}
          {trailing ? <span className={s.groupTrailing}>{trailing}</span> : null}
        </div>
      ) : null}
      {bare ? children : <div className={s.card}>{children}</div>}
      {footer ? (
        <div
          className={`${s.groupFooter} ${footerTone ? `${s.groupFooterTone} ${toneClass(footerTone)}` : ''}`}
          role={footerTone === 'critical' ? 'alert' : undefined}
        >
          {footerTone ? footerIcon : null}
          <span>{footer}</span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Fila con interruptor iOS: texto (y pista) a la izquierda, Switch a la derecha.
 * Toda la zona del texto es la etiqueta del Switch, así que tocarla lo cambia.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`${s.switchRow} ${className ?? ''}`} data-disabled={disabled || undefined}>
      <Switch
        labelPosition='left'
        label={label}
        description={hint}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size='md'
        styles={{
          root: { width: '100%' },
          body: { justifyContent: 'space-between', alignItems: 'center' },
          labelWrapper: { flex: 1, minWidth: 0 },
          label: { fontSize: 14, fontWeight: 500 },
          description: { fontSize: 12, lineHeight: 1.4 },
        }}
      />
    </div>
  );
}

/** Chip pequeño con tono (ícono + texto). */
export function TonePill({ tone, icon, children }: { tone: StatusTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`${s.chip} ${s.chipTone} ${toneClass(tone)}`}>
      {icon}
      {children}
    </span>
  );
}

/* ─────────────────────────────── Hoja de acción ─────────────────────────────── */

export function ActionSheet({
  opened,
  title,
  message,
  confirmLabel,
  confirmIcon,
  destructive = true,
  loading = false,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancelar',
}: {
  opened: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const isMobile = useMediaQuery('(max-width: 600px)', false);
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!loading) onCancel();
      }}
      withCloseButton={false}
      centered={!isMobile}
      size={360}
      zIndex={400}
      padding={0}
      classNames={{ content: `${ps.root} ${s.root} ${s.actionSheet}`, body: s.actionSheetBody, inner: s.actionSheetInner }}
      aria-label={title}
    >
      <div className={s.actionSheetCard}>
        <div className={s.actionSheetText}>
          <div className={s.actionSheetTitle}>{title}</div>
          {message ? <div className={s.actionSheetMessage}>{message}</div> : null}
        </div>
        <button
          type='button'
          className={`${s.sheetButton} ${destructive ? s.sheetButtonDanger : ''}`}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? <Loader size='xs' color='currentColor' /> : confirmIcon}
          {confirmLabel}
        </button>
      </div>
      <div className={s.actionSheetCard}>
        <button type='button' className={`${s.sheetButton} ${s.sheetButtonCancel}`} onClick={onCancel} disabled={loading} data-autofocus>
          {cancelLabel}
        </button>
      </div>
    </Modal>
  );
}
