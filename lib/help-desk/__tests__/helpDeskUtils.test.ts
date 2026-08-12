import { describe, it, expect } from 'vitest';
import { parseTicketDate, formatTicketDateIso } from '../dates';
import { getPriorityColor, getStatusColor } from '../ticketDisplay';
import {
  getCaseContactEmail,
  getCaseContactEmailDisplay,
  normalizeCaseListItem,
  CONTACT_EMAIL_PLACEHOLDER,
} from '../contactEmail';
import { SAP_SOURCES, isSapField, SAP_SOURCE_KEYS } from '../../requests-general/sapSources';

// Pruebas de utilidades PURAS de la mesa de ayuda y de las fuentes SAP curadas
// del workflow de solicitudes generales: parsing/formateo de fechas de tickets,
// mapeo de prioridad/estado a color de la UI, resolución del correo de contacto
// del caso y clasificación de campos que se resuelven contra SAP.

describe('parseTicketDate', () => {
  it('acepta un Date válido tal cual', () => {
    const d = new Date(2026, 6, 28);
    expect(parseTicketDate(d)).toBe(d);
  });

  it('parsea cadenas con y sin hora', () => {
    expect(parseTicketDate('2026-07-28')?.getTime()).not.toBeNaN();
    expect(parseTicketDate('2026-07-28T15:00:00')?.getTime()).not.toBeNaN();
  });

  it('devuelve null para nulo, vacío, Date inválido o texto no fecha', () => {
    expect(parseTicketDate(null)).toBeNull();
    expect(parseTicketDate('')).toBeNull();
    expect(parseTicketDate('   ')).toBeNull();
    expect(parseTicketDate(new Date('inválida'))).toBeNull();
    expect(parseTicketDate('no-es-fecha')).toBeNull();
  });
});

describe('formatTicketDateIso', () => {
  it('devuelve solo la parte YYYY-MM-DD', () => {
    expect(formatTicketDateIso('2026-07-28T15:30:00Z')).toBe('2026-07-28');
  });

  it('usa el respaldo cuando la fecha no es válida', () => {
    expect(formatTicketDateIso(null)).toBe('—');
    expect(formatTicketDateIso('basura', 'N/D')).toBe('N/D');
  });
});

describe('getPriorityColor / getStatusColor — mapeo a color de UI', () => {
  it('prioridad: alta=rojo, media=amarillo, baja=verde', () => {
    expect(getPriorityColor('alta')).toBe('red');
    expect(getPriorityColor('Media')).toBe('yellow'); // insensible a mayúsculas
    expect(getPriorityColor('baja')).toBe('green');
  });

  it('prioridad desconocida o vacía -> gris', () => {
    expect(getPriorityColor('urgentísima')).toBe('gray');
    expect(getPriorityColor('')).toBe('gray');
  });

  it('estado: abierto=verde, resuelto=azul, cancelado=gris', () => {
    expect(getStatusColor('Abierto')).toBe('green');
    expect(getStatusColor('resuelto')).toBe('blue');
    expect(getStatusColor('cancelado')).toBe('gray');
  });

  it('estado desconocido -> gris', () => {
    expect(getStatusColor('en revisión')).toBe('gray');
  });
});

describe('getCaseContactEmail — correo de contacto del caso', () => {
  it('prioriza c.email sobre el alias contact_email', () => {
    expect(getCaseContactEmail({ email: 'a@x.com', contact_email: 'b@x.com' })).toBe('a@x.com');
  });

  it('cae al alias contact_email cuando email viene vacío', () => {
    expect(getCaseContactEmail({ email: '   ', contact_email: 'b@x.com' })).toBe('b@x.com');
  });

  it('devuelve cadena vacía si no hay ningún correo', () => {
    expect(getCaseContactEmail({})).toBe('');
    expect(getCaseContactEmail({ email: null, contact_email: null })).toBe('');
  });

  it('NO usa requester_email para mostrar (solo sirve para ownership SQL)', () => {
    expect(getCaseContactEmail({ requester_email: 'owner@x.com' })).toBe('');
  });
});

describe('getCaseContactEmailDisplay / normalizeCaseListItem', () => {
  it('muestra el placeholder cuando no hay correo', () => {
    expect(getCaseContactEmailDisplay({})).toBe(CONTACT_EMAIL_PLACEHOLDER);
    expect(getCaseContactEmailDisplay({ email: 'a@x.com' })).toBe('a@x.com');
  });

  it('normaliza el ítem de listado dejando email = contacto o undefined', () => {
    expect(normalizeCaseListItem({ email: '  a@x.com ' }).email).toBe('a@x.com');
    expect(normalizeCaseListItem({ email: '' }).email).toBeUndefined();
  });
});

describe('SAP sources — campos del workflow que se resuelven contra SAP', () => {
  it('isSapField reconoce las claves curadas y descarta las demás', () => {
    expect(isSapField('sap_items')).toBe(true);
    expect(isSapField('sap_business_partners')).toBe(true);
    expect(isSapField('texto')).toBe(false);
    expect(isSapField(null)).toBe(false);
    expect(isSapField(undefined)).toBe(false);
  });

  it('cada fuente declara entidad OData, campo valor y campo etiqueta', () => {
    for (const key of SAP_SOURCE_KEYS) {
      const src = SAP_SOURCES[key];
      expect(src.entity).toBeTruthy();
      expect(src.valueField).toBeTruthy();
      expect(src.labelField).toBeTruthy();
      expect(src.searchFields.length).toBeGreaterThan(0);
    }
  });

  it('la fuente de artículos excluye artículos congelados (regla de negocio)', () => {
    // Solo deben ofrecerse artículos activos (Valid eq tYES y Frozen eq tNO) en el selector.
    expect(SAP_SOURCES.sap_items.fixedFilter).toBe("Valid eq 'tYES' and Frozen eq 'tNO'");
    expect(SAP_SOURCES.sap_items.entity).toBe('Items');
    expect(SAP_SOURCES.sap_items.valueField).toBe('ItemCode');
  });
});
