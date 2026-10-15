'use client';

/**
 * Pantalla amable de SynerLink que reemplaza el error crudo de Next
 * ("Application error: a client-side exception has occurred").
 * Estilos en línea a propósito: global-error.tsx reemplaza el layout raíz y no
 * se puede contar con globals.css ni con chunks adicionales (pueden ser justo
 * lo que falló). Colores y tipografía de gss-design, igual que la página de
 * mantenimiento de IIS (deploy/iis/_mantenimiento/index.html).
 */
export default function PantallaActualizacion({
  recargando,
  esActualizacion,
  onReintentar,
}: {
  recargando: boolean;
  esActualizacion: boolean;
  onReintentar?: () => void;
}) {
  const titulo = recargando
    ? 'SynerLink se acaba de actualizar'
    : esActualizacion
      ? 'Hay una versión nueva de SynerLink'
      : 'Algo no cargó bien';
  const texto = recargando
    ? 'Estamos recargando la página…'
    : esActualizacion
      ? 'Recarga la página para seguir trabajando con la versión nueva.'
      : 'Recarga la página para continuar. Si vuelve a pasar, avísale al equipo de soporte.';

  return (
    <div
      role='alert'
      aria-live='polite'
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: '#f5f7fa',
        color: '#0f1a2c',
        fontFamily: '"Source Sans 3", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
        lineHeight: 1.5,
      }}
    >
      <main
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          border: '1px solid #d8dde6',
          borderRadius: 12,
          padding: '32px 24px',
          textAlign: 'center',
          boxShadow: '0 1px 2px rgba(15,26,44,.06), 0 4px 16px rgba(15,26,44,.06)',
        }}
      >
        <div
          aria-label='SynerLink'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif',
            fontWeight: 700,
            fontSize: 20,
            marginBottom: 24,
          }}
        >
          <svg width='28' height='28' viewBox='0 0 28 28' aria-hidden='true'>
            <rect width='28' height='28' rx='7' fill='#1a3c6e' />
            <circle cx='10' cy='14' r='4.5' fill='none' stroke='#fff' strokeWidth='2.2' />
            <circle cx='18' cy='14' r='4.5' fill='none' stroke='#fff' strokeWidth='2.2' />
          </svg>
          SynerLink
        </div>
        <h1 style={{ fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif', fontSize: 22, lineHeight: 1.3, margin: '0 0 8px' }}>
          {titulo}
        </h1>
        <p style={{ margin: '0 0 8px', color: '#38445a' }}>{texto}</p>
        {!recargando && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <button
              type='button'
              onClick={() => window.location.reload()}
              style={{
                font: 'inherit',
                fontWeight: 600,
                color: '#fff',
                background: '#1a3c6e',
                border: 0,
                borderRadius: 8,
                padding: '10px 20px',
                minHeight: 44,
                cursor: 'pointer',
              }}
            >
              Recargar
            </button>
            {onReintentar && !esActualizacion && (
              <button
                type='button'
                onClick={onReintentar}
                style={{
                  font: 'inherit',
                  fontWeight: 600,
                  color: '#1a3c6e',
                  background: '#fff',
                  border: '1px solid #d8dde6',
                  borderRadius: 8,
                  padding: '10px 20px',
                  minHeight: 44,
                  cursor: 'pointer',
                }}
              >
                Reintentar
              </button>
            )}
          </div>
        )}
        <div style={{ marginTop: 24, fontSize: 13, color: '#6a7689' }}>Group Shared Services Latinoamérica</div>
      </main>
    </div>
  );
}
