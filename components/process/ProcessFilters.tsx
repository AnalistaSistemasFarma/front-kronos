'use client';

import React from 'react';

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface ProcessFiltersProps {
  categories: FilterOption[];
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  className?: string;
  totalCount?: number;
}

const ProcessFilters: React.FC<ProcessFiltersProps> = ({
  categories,
  selectedCategory,
  onCategoryChange,
  className = '',
  totalCount,
}) => {
  const allCount =
    totalCount ?? categories.reduce((sum, cat) => sum + (cat.count || 0), 0);

  return (
    <div className={`ios-segments ${className}`} role='tablist' aria-label='Filtrar procesos'>
      <button
        type='button'
        role='tab'
        aria-selected={selectedCategory === null}
        className={`ios-segment ${selectedCategory === null ? 'ios-segment--active' : ''}`}
        onClick={() => onCategoryChange(null)}
      >
        Todos
        {allCount > 0 && <span className='ios-segment__count'>{allCount}</span>}
      </button>

      {categories.map((category) => (
        <button
          key={category.value}
          type='button'
          role='tab'
          aria-selected={selectedCategory === category.value}
          className={`ios-segment ${
            selectedCategory === category.value ? 'ios-segment--active' : ''
          }`}
          onClick={() => onCategoryChange(category.value)}
        >
          {category.label}
          {category.count && category.count > 0 ? (
            <span className='ios-segment__count'>{category.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
};

export default ProcessFilters;
