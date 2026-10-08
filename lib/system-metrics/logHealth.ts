/**
 * Una sola regla para el log de transacciones, la usan el resumen (insights), las alertas
 * tempranas y los dos mapas: antes cada uno tenía sus propios umbrales y se contradecían.
 *
 * El porcentaje solo no dice si hay peligro: un log al 97 % que puede crecer y tiene cientos de
 * GB de disco libre no está por llenarse; uno al 90 % con el archivo topado, sí. Por eso se mira
 * también si el archivo puede crecer, cuánto disco queda y por qué SQL no lo está liberando
 * (log_reuse_wait_desc).
 */

export type LogContext = {
  database: string;
  /** FULL | SIMPLE | BULK_LOGGED */
  recoveryModel: string | null;
  /** log_reuse_wait_desc: por qué SQL no puede reutilizar el espacio del log. */
  reuseWait: string | null;
  sizeMb: number | null;
  /** El archivo tiene crecimiento automático y no llegó a su tamaño máximo. null = no se sabe. */
  canGrow: boolean | null;
  /** Cuánto más puede crecer: lo menor entre el límite del archivo y el disco libre. */
  roomMb: number | null;
  volumeFreeMb: number | null;
  /** Horas desde el último respaldo de log; null si no hay ninguno registrado. */
  lastLogBackupHours: number | null;
  /** Si se pudo leer el historial de respaldos (msdb). */
  backupHistoryKnown: boolean;
};

export type LogSeverity = 'critical' | 'warning' | 'info';

export type LogVerdict = {
  severity: LogSeverity;
  /** Texto corto para las tarjetas de los mapas. */
  short: string;
  title: string;
  happening: string;
  why: string;
  risk: string;
  action: string;
};

export const LOG_THRESHOLDS = {
  /** Si el log no puede crecer (o no se sabe), avisar desde aquí. */
  warningPct: 85,
  criticalPct: 95,
  /** Con menos espacio que esto para crecer, se trata como si no pudiera crecer. */
  lowRoomMb: 2048,
  /** Puede crecer, pero queda poco disco: crítico. */
  tightRoomMb: 20480,
  /** Sin respaldo de log en este tiempo, en modo FULL, se considera que no hay respaldos. */
  staleBackupHours: 24,
};

const fmt = (n: number, digits = 0) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(n);

function sizeText(mb: number): string {
  return mb >= 1024 ? `${fmt(mb / 1024, mb >= 10240 ? 0 : 1)} GB` : `${fmt(mb)} MB`;
}

const WAIT_SHORT: Record<string, string> = {
  LOG_BACKUP: 'falta respaldo de log',
  ACTIVE_TRANSACTION: 'transacción abierta',
  ACTIVE_BACKUP_OR_RESTORE: 'respaldo en curso',
  REPLICATION: 'esperando replicación',
  AVAILABILITY_REPLICA: 'esperando réplica',
};

function backupGap(ctx: LogContext): string {
  if (ctx.lastLogBackupHours == null) return 'no hay respaldos de log';
  const days = Math.round(ctx.lastLogBackupHours / 24);
  return days >= 2 ? `el último respaldo de log fue hace ${fmt(days)} días` : 'el respaldo de log no alcanza';
}

function noBackups(ctx: LogContext): boolean {
  return (
    ctx.backupHistoryKnown && (ctx.lastLogBackupHours == null || ctx.lastLogBackupHours > LOG_THRESHOLDS.staleBackupHours)
  );
}

export function judgeLog(usedPct: number | null | undefined, ctx: LogContext | null): LogVerdict | null {
  if (usedPct == null || !Number.isFinite(usedPct)) return null;
  const T = LOG_THRESHOLDS;
  const db = ctx?.database ? ` de ${ctx.database}` : ' de la base';
  const pct = `${fmt(usedPct, 1)} %`;
  const wait = ctx?.reuseWait ?? null;
  const waitShort = wait ? WAIT_SHORT[wait] : undefined;

  const fixed = ctx == null || ctx.canGrow !== true || (ctx.roomMb != null && ctx.roomMb < T.lowRoomMb);
  if (fixed) {
    const severity: LogSeverity | null = usedPct >= T.criticalPct ? 'critical' : usedPct >= T.warningPct ? 'warning' : null;
    if (!severity) return null;
    const known = ctx != null && ctx.canGrow != null;
    return {
      severity,
      short: `Log ${pct}${known ? ' · no puede crecer' : ''}`,
      title: `El log de transacciones${db} está al ${pct}`,
      happening: known
        ? `El archivo donde SQL Server anota cada cambio está casi lleno y no tiene${ctx?.canGrow ? ' disco' : ' crecimiento automático'} para crecer.`
        : 'El archivo donde SQL Server anota cada cambio está casi lleno.',
      why:
        wait === 'LOG_BACKUP'
          ? 'La base está en modo de recuperación completo y el log no se está respaldando, así que SQL no puede reutilizar su espacio.'
          : 'Normalmente es que el respaldo del log no se está ejecutando, o una transacción muy larga no deja liberarlo.',
      risk: known
        ? 'Si se llena, SQL Server deja de aceptar escrituras: no se puede guardar nada.'
        : 'Si se llena y no puede crecer, SQL Server deja de aceptar escrituras: no se puede guardar nada.',
      action: 'Avisar al DBA para que respalde el log ahora y revise por qué no se está liberando.',
    };
  }

  const room = ctx.roomMb;
  const roomText = room != null ? ` y quedan ${sizeText(room)} para crecer` : '';
  const sizePart = ctx.sizeMb != null ? ` de ${sizeText(ctx.sizeMb)}` : '';

  if (usedPct < T.warningPct || !(wait === 'LOG_BACKUP' || wait === 'ACTIVE_TRANSACTION' || (room != null && room < T.tightRoomMb))) {
    if (wait === 'LOG_BACKUP' && ctx.recoveryModel === 'FULL' && noBackups(ctx)) {
      return {
        severity: 'info',
        short: `Log ${pct} · sin respaldo de log`,
        title: `El log${db} no se está respaldando`,
        happening: `Está al ${pct}${sizePart}; crece solo${roomText}.`,
        why: `La base está en modo de recuperación completo (FULL) y ${backupGap(ctx)}: SQL nunca puede reutilizar ese espacio.`,
        risk: 'Nada inmediato. El log crecerá de a poco sin límite mientras siga así.',
        action:
          'Pedir al DBA que programe respaldos del log (por ejemplo cada 15 a 60 minutos) o, si no se necesita restaurar a un minuto exacto, pasar la base a modo SIMPLE.',
      };
    }
    return null;
  }

  const severity: LogSeverity = room != null && room < T.tightRoomMb ? 'critical' : 'warning';
  const why =
    wait === 'LOG_BACKUP'
      ? `La base está en modo de recuperación completo (FULL) y ${backupGap(ctx)}: SQL no puede reutilizar ese espacio y el archivo solo crece.`
      : wait === 'ACTIVE_TRANSACTION'
        ? 'Hay una transacción abierta desde hace rato y, mientras no termine, SQL no puede liberar el log.'
        : `SQL está esperando "${wait ?? 'desconocido'}" para liberar el log.`;
  return {
    severity,
    short: `Log ${pct} · ${waitShort ?? 'no se libera'}`,
    title:
      wait === 'LOG_BACKUP'
        ? `El log${db} no se libera: falta el respaldo del log`
        : wait === 'ACTIVE_TRANSACTION'
          ? `Una transacción abierta no deja liberar el log${db}`
          : `El log${db} está al ${pct} y no se libera`,
    happening: `Está al ${pct}${sizePart} y sigue creciendo; el archivo crece solo${roomText}.`,
    why,
    risk:
      severity === 'critical'
        ? 'Queda poco espacio: cuando se acabe, SQL Server deja de aceptar escrituras y no se puede guardar nada.'
        : 'No es urgente: el archivo seguirá creciendo de a poco hasta ocupar el disco, y ahí SQL dejaría de aceptar escrituras.',
    action:
      wait === 'ACTIVE_TRANSACTION'
        ? 'Buscar la transacción abierta más vieja (DBCC OPENTRAN en esa base) y terminarla.'
        : 'Pedir al DBA que programe respaldos del log (por ejemplo cada 15 a 60 minutos) o, si no se necesita restaurar a un minuto exacto, pasar la base a modo SIMPLE.',
  };
}
