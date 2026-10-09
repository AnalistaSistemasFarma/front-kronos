import Link from 'next/link';
import {
  IconArrowRight,
  IconMail,
  IconPhone,
  IconMapPin,
  IconCheck,
} from '@tabler/icons-react';
import LandingMotion from '../components/landing/LandingMotion';
import LandingHeader from '../components/landing/LandingHeader';
import SynerLinkOrbit from '../components/landing/SynerLinkOrbit';
import ServiceCards from '../components/landing/ServiceCards';
import CountUp from '../components/landing/CountUp';
import CompanyShowcase from '../components/landing/CompanyShowcase';
import BenefitsVisual from '../components/landing/BenefitsVisual';
import styles from '../components/landing/landing.module.css';

const BENEFITS = [
  'Reducción significativa de costos operativos',
  'Mejora en la calidad y eficiencia de procesos',
  'Acceso a expertise especializado',
  'Escalabilidad según las necesidades del negocio',
  'Cumplimiento normativo garantizado',
  'Enfoque en el core business de tu empresa',
];

const STATS = [
  { value: '500+', label: 'Empresas Atendidas' },
  { value: '98%', label: 'Satisfacción del Cliente' },
  { value: '35%', label: 'Ahorro Promedio' },
];

const FOOTER_SERVICES = ['Recursos Humanos', 'Finanzas y Contabilidad', 'Servicios de TI', 'Compras'];
const FOOTER_COMPANY = ['Nosotros', 'Carreras', 'Casos de Éxito', 'Blog'];

/** Las animaciones (GSAP) viven en LandingMotion y se enganchan a los atributos data-*. */
export default function LandingPage() {
  return (
    <LandingMotion>
      <LandingHeader />

      {/* Hero */}
      <section className={styles.hero} data-hero-section>
        <div className={styles.heroBg} aria-hidden>
          <span className={styles.depthLayer} data-depth='0.6'>
            <span className={`${styles.blob} ${styles.blobA}`} />
          </span>
          <span className={styles.depthLayer} data-depth='1.1'>
            <span className={`${styles.blob} ${styles.blobB}`} />
          </span>
          <span className={styles.depthLayer} data-depth='1.6'>
            <span className={`${styles.blob} ${styles.blobC}`} />
          </span>
          <span className={styles.dots} />
          <span className={styles.heroGlow} data-hero-glow />
        </div>

        <div className={`${styles.container} ${styles.heroGrid}`}>
          <div data-hero-copy>
            <span className={styles.eyebrow} data-hero data-hero-eyebrow>
              <span className={styles.eyebrowDot} />
              Optimizando Operaciones Desde 2020
            </span>
            <h1 className={styles.heroTitle} data-hero data-hero-title>
              Excelencia Centralizada para las{' '}
              <span className={styles.gradientText}>Operaciones de tu Negocio</span>
            </h1>
            <p className={styles.heroText} data-hero data-hero-text>
              Transforma tu organización con nuestra plataforma integral de servicios compartidos.
              Consolidamos Recursos Humanos, Finanzas, TI y Operaciones en un único centro eficiente que
              impulsa el ahorro de costos y la excelencia operativa.
            </p>
            <div className={styles.heroActions} data-hero data-hero-actions>
              <button type='button' className={`${styles.btn} ${styles.btnPrimary}`} data-magnetic>
                Solicitar Demo
                <IconArrowRight size={18} />
              </button>
              <a href='#services' className={`${styles.btn} ${styles.btnGlass}`} data-magnetic>
                Saber Más
              </a>
            </div>
          </div>

          <div data-hero-visual>
            <SynerLinkOrbit />
          </div>
        </div>
      </section>

      {/* Empresas que confían en nosotros */}
      <section className={styles.trusted} aria-labelledby='trusted-title'>
        <div className={`${styles.container} ${styles.trustedHead}`}>
          <span className={styles.kicker} data-fade>
            Nuestras empresas
          </span>
          <h2 id='trusted-title' className={styles.trustedTitle} data-split>
            Empresas que confían en nosotros
          </h2>
          <p className={styles.trustedText} data-fade>
            Solicitudes y aprobaciones, conexión a SAP Business One, firma electrónica y reportes BI para
            cada compañía del grupo.
          </p>
        </div>
        <div className={styles.container}>
          <CompanyShowcase />
        </div>
      </section>

      {/* Servicios */}
      <section className={styles.section} id='services'>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker} data-fade>
              Servicios
            </span>
            <h2 className={styles.sectionTitle} data-split>
              Nuestros Servicios
            </h2>
            <p className={styles.sectionText} data-fade>
              Una suite completa de servicios empresariales diseñados para optimizar tus operaciones
            </p>
          </div>
          <ServiceCards />
        </div>
      </section>

      {/* Beneficios */}
      <section className={`${styles.section} ${styles.sectionTint}`} id='benefits'>
        <div className={`${styles.container} ${styles.benefitsGrid}`}>
          <div>
            <span className={styles.kicker} data-fade>
              Beneficios
            </span>
            <h2 className={`${styles.sectionTitle} ${styles.benefitsTitle}`} data-split>
              Beneficios que Transforman tu Negocio
            </h2>
            <ul className={styles.benefitList}>
              {BENEFITS.map((benefit) => (
                <li key={benefit} className={styles.benefit} data-benefit>
                  <span className={styles.check} data-check>
                    <IconCheck size={16} stroke={3} />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>
          </div>

          <BenefitsVisual />
        </div>
      </section>

      {/* Cifras */}
      <section className={styles.section} id='about'>
        <div className={`${styles.container} ${styles.stats}`}>
          {STATS.map((stat) => (
            <div key={stat.label} className={styles.stat} data-stat>
              <CountUp value={stat.value} className={styles.statValue} />
              <span className={styles.statLabel}>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Llamado a la acción */}
      <section>
        <div className={styles.container}>
          <div className={styles.ctaCard} data-cta>
            <span className={styles.ctaGlow} aria-hidden />
            <h2 className={styles.ctaTitle} data-split>
              ¿Listo para Transformar tus Operaciones?
            </h2>
            <p className={styles.ctaText} data-fade>
              Únete a cientos de empresas que ya han optimizado sus procesos con nuestros servicios
              compartidos.
            </p>
            <div className={styles.ctaActions} data-fade>
              <Link href='/register' className={`${styles.btn} ${styles.btnWhite}`} data-magnetic>
                Comenzar Ahora
                <IconArrowRight size={18} />
              </Link>
              <a href='#contact' className={`${styles.btn} ${styles.btnOutlineLight}`} data-magnetic>
                Contactar Ventas
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Pie de página */}
      <footer className={styles.footer} id='contact'>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div data-fade>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src='/Logo_Principal_Blanco_Ancho.svg'
              alt='ServiciosCompartidos Logo'
              className={styles.footerLogo}
            />
            <p className={styles.footerText}>
              Entregando excelencia operativa a través de servicios empresariales centralizados.
            </p>
          </div>

          <div data-fade>
            <h4 className={styles.footerTitle}>Servicios</h4>
            <ul className={styles.footerList}>
              {FOOTER_SERVICES.map((item) => (
                <li key={item}>
                  <a href='#' className={styles.footerLink}>
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div data-fade>
            <h4 className={styles.footerTitle}>Empresa</h4>
            <ul className={styles.footerList}>
              {FOOTER_COMPANY.map((item) => (
                <li key={item}>
                  <a href='#' className={styles.footerLink}>
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div data-fade>
            <h4 className={styles.footerTitle}>Contacto</h4>
            <ul className={styles.footerList}>
              <li className={styles.contactItem}>
                <span className={styles.contactIcon}>
                  <IconMail size={16} />
                </span>
                contacto@servicioscompartidos.com
              </li>
              <li className={styles.contactItem}>
                <span className={styles.contactIcon}>
                  <IconPhone size={16} />
                </span>
                +1 (555) 123-4567
              </li>
              <li className={styles.contactItem}>
                <span className={styles.contactIcon}>
                  <IconMapPin size={16} />
                </span>
                Av. Empresarial 123, Suite 100
              </li>
            </ul>
          </div>
        </div>

        <div className={styles.container}>
          <div className={styles.copyright}>
            © {new Date().getFullYear()} ServiciosCompartidos. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </LandingMotion>
  );
}
