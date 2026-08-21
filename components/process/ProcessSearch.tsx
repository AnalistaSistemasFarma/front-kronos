'use client';

import React from 'react';
import { TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

interface ProcessSearchProps {
  value: string;
  onChange: (value: string) => void;
  onFilterClick?: () => void;
  placeholder?: string;
  loading?: boolean;
}

const ProcessSearch: React.FC<ProcessSearchProps> = ({
  value,
  onChange,
  placeholder = 'Buscar un proceso o acceso…',
  loading = false,
}) => {
  return (
    <div className='ios-search'>
      <IconSearch className='ios-search__icon' size={18} aria-hidden />
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        variant='unstyled'
        disabled={loading}
        aria-label='Buscar procesos'
        style={{ flex: 1 }}
        styles={{
          input: {
            fontSize: 16,
            minHeight: 44,
            padding: 0,
          },
        }}
      />
    </div>
  );
};

export default ProcessSearch;
