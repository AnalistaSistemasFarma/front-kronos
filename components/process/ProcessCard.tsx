'use client';

import React, { useEffect, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import {
  accentForProcess,
  headerIconForProcess,
  uniqueSubprocessIcons,
  type ProcessAccent,
} from '../../lib/process/processVisuals';

interface Company {
  id_company: number;
  company: string;
}

interface CompanyUser {
  id_company_user: number;
  company: Company;
}

interface SubprocessUserCompany {
  id_subprocess_user_company: number;
  companyUser: CompanyUser;
}

interface ProcessSubprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url?: string;
  subprocessUserCompanies?: SubprocessUserCompany[];
}

interface Process {
  id_process: number;
  process: string;
  process_url?: string;
  subprocesses: ProcessSubprocess[];
  status?: 'active' | 'inactive' | 'pending';
  lastAccessed?: string;
  company?: string;
  description?: string;
}

interface ProcessCardProps {
  process: Process;
  onProcessClick: (processId: number) => void;
  onSubprocessClick: (subprocess: ProcessSubprocess) => void;
  className?: string;
  /** Índice en la grilla: rota el color al agregar más procesos. */
  colorIndex?: number;
  /** Modo comprimir: solo título; al tocar se abre la lista. */
  compressed?: boolean;
  /** Si hay búsqueda activa, expandir para no ocultar coincidencias. */
  forceExpanded?: boolean;
}

const ProcessCard: React.FC<ProcessCardProps> = ({
  process,
  onSubprocessClick,
  className = '',
  colorIndex = 0,
  compressed = false,
  forceExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const accent: ProcessAccent = accentForProcess(colorIndex);
  const HeaderIcon = headerIconForProcess(process.process);
  // Íconos calculados en un orden fijo (por id): si los accesos se reordenan por uso,
  // cada uno conserva su ícono.
  const stableOrder = [...process.subprocesses].sort((a, b) => a.id_subprocess - b.id_subprocess);
  const stableIcons = uniqueSubprocessIcons(stableOrder.map((s) => s.subprocess));
  const iconById = new Map(stableOrder.map((s, i) => [s.id_subprocess, stableIcons[i]]));
  const rowIcons = process.subprocesses.map((s) => iconById.get(s.id_subprocess)!);

  const total = process.subprocesses.length;
  // Sin comprimir: lista siempre visible. Con comprimir: cerrada hasta que la abran (o búsqueda).
  const open = !compressed || forceExpanded || expanded;

  useEffect(() => {
    if (!compressed) setExpanded(false);
  }, [compressed]);

  const headClass = 'ios-process-card__head';
  const headInner = (
    <>
      <div className='ios-process-card__glyph' aria-hidden>
        <HeaderIcon size={22} />
      </div>
      <div className='ios-process-card__titles'>
        <h3 className='ios-process-card__title'>{process.process}</h3>
        <p className='ios-process-card__meta'>
          {total} {total === 1 ? 'acceso' : 'accesos'}
          {compressed && !open && total > 0 ? ' · tocar para ver' : ''}
        </p>
      </div>
      {compressed ? (
        <IconChevronDown
          size={18}
          className={`ios-process-card__toggle ${open ? 'ios-process-card__toggle--open' : ''}`}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <article
      className={`ios-process-card ios-process-card--${accent} ${
        open ? 'ios-process-card--open' : 'ios-process-card--closed'
      } ${compressed ? 'ios-process-card--compressible' : ''} ${className}`}
    >
      {compressed ? (
        <button
          type='button'
          className={headClass}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={open}
          aria-controls={`process-list-${process.id_process}`}
        >
          {headInner}
        </button>
      ) : (
        <header className={headClass}>{headInner}</header>
      )}

      {open && total > 0 ? (
        <ul className='ios-process-list' id={`process-list-${process.id_process}`}>
          {process.subprocesses.map((subprocess, index) => {
            const RowIcon = rowIcons[index];
            return (
              <li key={subprocess.id_subprocess}>
                <button
                  type='button'
                  className='ios-process-row'
                  onClick={() => onSubprocessClick(subprocess)}
                >
                  <span className='ios-process-row__icon'>
                    <RowIcon size={18} />
                  </span>
                  <span className='ios-process-row__label'>{subprocess.subprocess}</span>
                  <IconChevronRight size={16} className='ios-process-row__chevron' aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
};

export default ProcessCard;
