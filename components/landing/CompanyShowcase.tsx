import styles from './landing.module.css';

/** Compañías del grupo que usan SynerLink (cada una con su propia base SAP Business One). */
const COMPANIES = [
  { code: 'FAR', name: 'Farmalógica', logo: '/landing/empresas/farmalogica.png', wide: true },
  { code: 'OLP', name: 'OneLatam Pharma', logo: '/landing/empresas/onelatam-pharma.svg' },
  { code: 'ABA', name: 'Abamia', logo: '/landing/empresas/abamia.png' },
  { code: 'MED', name: 'Meditrack', logo: '/landing/empresas/meditrack.png' },
  { code: 'KEL', name: 'Kelab Analítica', logo: '/landing/empresas/kelab.png' },
  { code: 'RYA', name: 'Ryan Lab', logo: '/landing/empresas/ryan.png', wide: true },
];

/**
 * Mosaico del ecosistema: GSS (casa matriz que opera la plataforma) como pieza principal y una
 * tarjeta por compañía con su sigla y su conexión a SAP. GSAP las hace entrar (data-company).
 */
export default function CompanyShowcase() {
  return (
    <div className={styles.ecosystem}>
      <div className={styles.featuredCell} data-company>
        <article className={styles.featured}>
          <span className={styles.featuredLabel}>Casa matriz</span>
          <div className={styles.featuredHead}>
            <span className={styles.featuredLogo}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src='/landing/empresas/gss.png' alt='Logo de Group Shared Services' />
            </span>
            <div>
              <h3 className={styles.featuredName}>GSS LATAM</h3>
              <p className={styles.featuredSub}>Group Shared Services</p>
            </div>
          </div>
          <p className={styles.featuredText}>
            Opera SynerLink para todo el grupo: solicitudes y aprobaciones entre áreas, conexión a SAP,
            documentos y firma electrónica, archivos en OneDrive y reportes BI.
          </p>
          <div className={styles.featuredFoot}>
            <span className={styles.avatarStack} aria-hidden>
              {COMPANIES.map((c) => (
                <span key={c.code} className={styles.avatar}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.logo} alt='' />
                </span>
              ))}
            </span>
            <span className={styles.featuredCount}>
              <b>{COMPANIES.length}</b> compañías conectadas
            </span>
          </div>
        </article>
      </div>

      {COMPANIES.map((c) => (
        <div key={c.code} className={styles.companyCell} data-company>
          <article className={styles.companyTile}>
            <div className={styles.companyTop}>
              <span className={styles.companyCode}>{c.code}</span>
              <span className={styles.sapStatus}>
                <span className={styles.liveDot} aria-hidden />
                SAP Business One
              </span>
            </div>
            <div className={styles.companyLogoArea}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.logo}
                alt={`Logo de ${c.name}`}
                className={`${styles.tileLogo} ${c.wide ? styles.tileLogoWide : ''}`}
                loading='lazy'
              />
            </div>
            <h3 className={styles.companyTileName}>{c.name}</h3>
          </article>
        </div>
      ))}
    </div>
  );
}
