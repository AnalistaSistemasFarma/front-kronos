import { describe, expect, it } from 'vitest';
import { judgeLog, type LogContext } from '../logHealth';

function ctx(p: Partial<LogContext> = {}): LogContext {
  return {
    database: 'KRONOSDB',
    recoveryModel: 'FULL',
    reuseWait: 'LOG_BACKUP',
    sizeMb: 264,
    canGrow: true,
    roomMb: 385_000,
    volumeFreeMb: 385_000,
    lastLogBackupHours: null,
    backupHistoryKnown: true,
    ...p,
  };
}

describe('judgeLog', () => {
  it('sin dato no opina', () => {
    expect(judgeLog(null, ctx())).toBeNull();
  });

  it('sin contexto usa umbrales fijos 85 / 95', () => {
    expect(judgeLog(80, null)).toBeNull();
    expect(judgeLog(88, null)?.severity).toBe('warning');
    expect(judgeLog(96, null)?.severity).toBe('critical');
  });

  it('caso real de producción: 97 % pero puede crecer y sobra disco → atención, no crítico', () => {
    const v = judgeLog(96.87, ctx());
    expect(v?.severity).toBe('warning');
    expect(v?.short).toBe('Log 96,9 % · falta respaldo de log');
    expect(v?.why).toContain('no hay respaldos de log');
    expect(v?.risk).toContain('No es urgente');
  });

  it('caso real de pruebas: 83 % sin respaldos de log → solo informativo', () => {
    const v = judgeLog(82.6, ctx({ database: 'KRONOSDB_PRUEBAS' }));
    expect(v?.severity).toBe('info');
    expect(v?.title).toContain('KRONOSDB_PRUEBAS no se está respaldando');
  });

  it('con respaldos de log recientes y bajo el umbral no dice nada', () => {
    expect(judgeLog(60, ctx({ lastLogBackupHours: 0.5 }))).toBeNull();
  });

  it('puede crecer pero queda poco disco → crítico', () => {
    expect(judgeLog(90, ctx({ roomMb: 10_000 }))?.severity).toBe('critical');
  });

  it('no puede crecer → crítico desde 95 %', () => {
    const v = judgeLog(96, ctx({ canGrow: false, roomMb: 0 }));
    expect(v?.severity).toBe('critical');
    expect(v?.risk).toContain('deja de aceptar escrituras');
    expect(judgeLog(90, ctx({ canGrow: false, roomMb: 0 }))?.severity).toBe('warning');
  });

  it('transacción abierta → atención con su acción', () => {
    const v = judgeLog(92, ctx({ reuseWait: 'ACTIVE_TRANSACTION' }));
    expect(v?.severity).toBe('warning');
    expect(v?.action).toContain('DBCC OPENTRAN');
  });

  it('alto pero se libera solo (NOTHING) → nada', () => {
    expect(judgeLog(92, ctx({ reuseWait: 'NOTHING' }))).toBeNull();
  });
});
