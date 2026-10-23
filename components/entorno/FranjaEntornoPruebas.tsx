/**
 * Marca discreta del ENTORNO DE PRUEBAS: una línea ámbar de 3 px en el borde
 * superior y una etiqueta pequeña «PRUEBAS» centrada. No captura clics ni
 * desplaza el contenido. Solo se monta con SYNERLINK_ENTORNO=pruebas (app/layout.tsx).
 */
export default function FranjaEntornoPruebas() {
  return (
    <div
      aria-label='Entorno de pruebas'
      role='note'
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: '#F59F00',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '1px 10px 2px',
          borderRadius: '0 0 6px 6px',
          background: '#F59F00',
          color: '#1f1300',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          lineHeight: '14px',
          fontFamily: 'inherit',
        }}
      >
        PRUEBAS
      </span>
    </div>
  );
}
