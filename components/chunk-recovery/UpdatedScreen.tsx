'use client';

// Pantalla amable de SynerLink (gss-design: azul #0078D4, tipografía del sistema,
// tarjeta centrada). Estilos en línea porque también se usa en global-error,
// donde no hay layout ni CSS global garantizado.
export default function UpdatedScreen({ reloading, onReload }: { reloading: boolean; onReload: () => void }) {
  return (
    <div
      role='alert'
      data-testid='synerlink-updated-screen'
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#F4F7FB',
        fontFamily: "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif",
        color: '#1F2937',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(0, 47, 95, 0.12)',
          padding: '32px 28px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0078D4', marginBottom: 16 }}>SynerLink</div>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
          {reloading ? 'SynerLink se acaba de actualizar. Estamos recargando…' : 'SynerLink se acaba de actualizar.'}
        </h1>
        <p style={{ fontSize: 14, color: '#4B5563', margin: '0 0 24px' }}>
          {reloading
            ? 'En un momento verá la versión más reciente.'
            : 'Presione «Recargar» para continuar con la versión más reciente.'}
        </p>
        <button
          type='button'
          onClick={onReload}
          style={{
            background: '#0078D4',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 8,
            padding: '10px 28px',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Recargar
        </button>
      </div>
    </div>
  );
}
