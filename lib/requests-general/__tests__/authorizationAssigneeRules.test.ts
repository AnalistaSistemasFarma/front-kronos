import { describe, expect, it } from 'vitest';
import { resolveAuthorizationAssigneeEmail } from '../authorizationAssigneeRules';

describe('resolveAuthorizationAssigneeEmail', () => {
  it('enruta Solicitud de Pago de Dayana a Jorge Alba', () => {
    expect(
      resolveAuthorizationAssigneeEmail('dayana.vargas@gsslatam.com', 'Solicitud de Pago')
    ).toBe('jorge.alba@gsslatam.com');
  });

  it('ignora mayúsculas en el email del solicitante', () => {
    expect(
      resolveAuthorizationAssigneeEmail('Dayana.Vargas@GSSLatam.com', 'Solicitud de Pago')
    ).toBe('jorge.alba@gsslatam.com');
  });

  it('no enruta otros procesos de Dayana', () => {
    expect(
      resolveAuthorizationAssigneeEmail('dayana.vargas@gsslatam.com', 'Solicitud de firma')
    ).toBeNull();
  });

  it('no enruta Solicitud de Pago de otro solicitante', () => {
    expect(
      resolveAuthorizationAssigneeEmail('jeyson@meditrack.com.co', 'Solicitud de Pago')
    ).toBeNull();
  });
});
