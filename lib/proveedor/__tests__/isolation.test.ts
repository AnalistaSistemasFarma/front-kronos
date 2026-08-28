import { describe, it, expect } from 'vitest';
import {
  SUPPLIER_ROLE,
  normalizeNit,
  extractSupplierIdentity,
  assertOwnership,
  isSupplierProtectedPath,
  isInternalApiPath,
  type SessionLike,
} from '../isolation';

// Sesiones de prueba (proveedor A, proveedor B, usuario interno).
const proveedorA: SessionLike = {
  user: { id: 'userA', role: SUPPLIER_ROLE, nit: '900123456' },
};
const proveedorB: SessionLike = {
  user: { id: 'userB', role: SUPPLIER_ROLE, nit: '800987654' },
};
const interno: SessionLike = {
  user: { id: 'userInterno', role: 'admin', nit: null },
};

describe('aislamiento de proveedores — normalizeNit', () => {
  it('recorta espacios y descarta puntos/guiones', () => {
    expect(normalizeNit(' 900.123.456-7 ')).toBe('9001234567');
  });

  it('devuelve string vacío para null/undefined', () => {
    expect(normalizeNit(null)).toBe('');
    expect(normalizeNit(undefined)).toBe('');
  });
});

describe('aislamiento de proveedores — extractSupplierIdentity', () => {
  it('devuelve la identidad para una sesión de proveedor válida', () => {
    expect(extractSupplierIdentity(proveedorA)).toEqual({ userId: 'userA', nit: '900123456' });
  });

  it('DENIEGA (null) cuando no hay sesión', () => {
    expect(extractSupplierIdentity(null)).toBeNull();
    expect(extractSupplierIdentity(undefined)).toBeNull();
    expect(extractSupplierIdentity({})).toBeNull();
  });

  it('DENIEGA a un usuario interno (rol distinto de supplier)', () => {
    expect(extractSupplierIdentity(interno)).toBeNull();
  });

  it('DENIEGA si falta el NIT aunque el rol sea supplier', () => {
    expect(
      extractSupplierIdentity({ user: { id: 'x', role: SUPPLIER_ROLE, nit: null } })
    ).toBeNull();
  });

  it('DENIEGA si falta el id de usuario', () => {
    expect(
      extractSupplierIdentity({ user: { id: '', role: SUPPLIER_ROLE, nit: '900' } })
    ).toBeNull();
  });
});

describe('aislamiento de proveedores — assertOwnership (anti-IDOR)', () => {
  it('permite acceso a un recurso propio', () => {
    const a = extractSupplierIdentity(proveedorA)!;
    // Solicitud cuyo id_requester es el propio proveedor A.
    expect(assertOwnership('userA', a.userId)).toBe(true);
  });

  it('BLOQUEA que el proveedor A lea un recurso del proveedor B', () => {
    const a = extractSupplierIdentity(proveedorA)!;
    // Solicitud cuyo id_requester pertenece al proveedor B.
    expect(assertOwnership('userB', a.userId)).toBe(false);
  });

  it('BLOQUEA cuando el id_requester del recurso es nulo/vacío', () => {
    expect(assertOwnership(null, 'userA')).toBe(false);
    expect(assertOwnership('', 'userA')).toBe(false);
  });

  it('BLOQUEA cuando no hay identidad de proveedor (userId vacío)', () => {
    expect(assertOwnership('userA', '')).toBe(false);
    expect(assertOwnership('userA', null)).toBe(false);
  });

  it('los dos proveedores nunca se cruzan entre sí', () => {
    const a = extractSupplierIdentity(proveedorA)!;
    const b = extractSupplierIdentity(proveedorB)!;
    expect(assertOwnership('userA', a.userId)).toBe(true);
    expect(assertOwnership('userA', b.userId)).toBe(false);
    expect(assertOwnership('userB', b.userId)).toBe(true);
    expect(assertOwnership('userB', a.userId)).toBe(false);
  });
});

describe('aislamiento de proveedores — guardas de ruta', () => {
  it('reconoce el área protegida de proveedores', () => {
    expect(isSupplierProtectedPath('/proveedor/portal')).toBe(true);
    expect(isSupplierProtectedPath('/proveedor/portal/solicitudes')).toBe(true);
    expect(isSupplierProtectedPath('/api/proveedor/solicitudes')).toBe(true);
  });

  it('el login del proveedor NO es área protegida (es público)', () => {
    expect(isSupplierProtectedPath('/proveedor/login')).toBe(false);
  });

  it('marca como interna toda API que no sea del proveedor/auth/public/health', () => {
    expect(isInternalApiPath('/api/requests-general/view-request')).toBe(true);
    expect(isInternalApiPath('/api/users')).toBe(true);
    expect(isInternalApiPath('/api/payment-assistant/proposal')).toBe(true);
  });

  it('NO marca como interna la API del proveedor ni auth/public/health', () => {
    expect(isInternalApiPath('/api/proveedor/solicitudes')).toBe(false);
    expect(isInternalApiPath('/api/auth/session')).toBe(false);
    expect(isInternalApiPath('/api/public/external-form/1')).toBe(false);
    expect(isInternalApiPath('/api/health/database')).toBe(false);
  });
});
