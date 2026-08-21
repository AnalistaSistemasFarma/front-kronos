'use client';

import React from 'react';
import { IconChevronRight } from '@tabler/icons-react';
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
}

const ProcessCard: React.FC<ProcessCardProps> = ({
  process,
  onSubprocessClick,
  className = '',
  colorIndex = 0,
}) => {
  const accent: ProcessAccent = accentForProcess(colorIndex);
  const HeaderIcon = headerIconForProcess(process.process);
  const rowIcons = uniqueSubprocessIcons(
    process.subprocesses.map((s) => s.subprocess),
  );

  return (
    <article className={`ios-process-card ios-process-card--${accent} ${className}`}>
      <header className='ios-process-card__head'>
        <div className='ios-process-card__glyph' aria-hidden>
          <HeaderIcon size={22} />
        </div>
        <div className='ios-process-card__titles'>
          <h3 className='ios-process-card__title'>{process.process}</h3>
          <p className='ios-process-card__meta'>
            {process.subprocesses.length}{' '}
            {process.subprocesses.length === 1 ? 'acceso' : 'accesos'}
          </p>
        </div>
      </header>

      {process.subprocesses.length > 0 && (
        <ul className='ios-process-list'>
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
      )}
    </article>
  );
};

export default ProcessCard;
