'use client';

import React from 'react';
import { TextInput } from '@mantine/core';
import { IconSearch, IconFilter } from '@tabler/icons-react';
import GradientButton from '../ui/GradientButton';

interface ProcessSearchProps {
  value: string;
  onChange: (value: string) => void;
  onFilterClick: () => void;
  placeholder?: string;
  loading?: boolean;
}

const ProcessSearch: React.FC<ProcessSearchProps> = ({
  value,
  onChange,
  onFilterClick,
  placeholder = 'Buscar procesos...',
  loading = false,
}) => {
  return (
    <div className='process-search'>
      <div className='search-input-container'>
        <IconSearch className='search-icon' size={20} />
        <TextInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className='search-input'
          variant='unstyled'
          disabled={loading}
        />
      </div>

      <div className='search-actions'>
        <GradientButton
          size='sm'
          variant='outline'
          onClick={onFilterClick}
          leftIcon={<IconFilter size={16} />}
        >
          Filtros
        </GradientButton>
      </div>

      <style jsx>{`
        .process-search {
          display: flex;
          gap: 12px;
          align-items: center;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 12px;
          padding: 16px;
          border: 1px solid rgba(102, 126, 234, 0.2);
          transition: all 0.3s ease;
        }

        :global(.dark) .process-search {
          background: rgba(31, 41, 55, 0.8);
          border: 1px solid rgba(75, 85, 99, 0.3);
        }

        .process-search:focus-within {
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          transform: translateY(-1px);
        }

        .search-input-container {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .search-icon {
          color: #667eea;
          flex-shrink: 0;
        }

        .search-input {
          flex: 1;
          font-size: 16px;
        }

        .search-input :global(input) {
          color: #333;
          font-size: 16px;
          padding: 0;
        }

        :global(.dark) .search-input :global(input) {
          color: #e5e7eb;
        }

        .search-input :global(input::placeholder) {
          color: #999;
        }

        :global(.dark) .search-input :global(input::placeholder) {
          color: #6b7280;
        }

        .search-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .process-search {
            flex-direction: column;
            gap: 12px;
          }

          .search-input-container {
            width: 100%;
          }

          .search-actions {
            width: 100%;
            justify-content: flex-end;
          }
        }
      `}</style>
    </div>
  );
};

export default ProcessSearch;
