'use client';

import React from 'react';
import { Group, Badge } from '@mantine/core';

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
}

const ProcessFilters: React.FC<ProcessFiltersProps> = ({
  categories,
  selectedCategory,
  onCategoryChange,
  className = '',
}) => {
  return (
    <div className={`process-filters ${className}`}>
      <Group gap='xs' className='filter-tabs'>
        <button
          className={`filter-tab ${selectedCategory === null ? 'filter-tab--active' : ''}`}
          onClick={() => onCategoryChange(null)}
        >
          Todos los procesos
          {categories.reduce((sum, cat) => sum + (cat.count || 0), 0) > 0 && (
            <Badge size='xs' className='filter-count'>
              {categories.reduce((sum, cat) => sum + (cat.count || 0), 0)}
            </Badge>
          )}
        </button>

        {categories.map((category) => (
          <button
            key={category.value}
            className={`filter-tab ${
              selectedCategory === category.value ? 'filter-tab--active' : ''
            }`}
            onClick={() => onCategoryChange(category.value)}
          >
            {category.label}
            {category.count && category.count > 0 && (
              <Badge size='xs' className='filter-count'>
                {category.count}
              </Badge>
            )}
          </button>
        ))}
      </Group>

      <style jsx>{`
        .process-filters {
          padding: 8px;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 12px;
          margin-bottom: 24px;
          overflow-x: auto;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        :global(.dark) .process-filters {
          background: rgba(31, 41, 55, 0.8);
          border: 1px solid rgba(75, 85, 99, 0.3);
        }

        .filter-tabs {
          display: flex;
          gap: 8px;
          min-width: max-content;
        }

        .filter-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 20px;
          border-radius: 8px;
          background: transparent;
          border: none;
          font-size: 14px;
          font-weight: 500;
          color: #666;
          cursor: pointer;
          transition: all 0.3s ease;
          white-space: nowrap;
          position: relative;
        }

        :global(.dark) .filter-tab {
          color: #9ca3af;
        }

        .filter-tab:hover:not(.filter-tab--active) {
          background: rgba(102, 126, 234, 0.1);
          color: #113562;
          transform: translateY(-1px);
        }

        :global(.dark) .filter-tab:hover:not(.filter-tab--active) {
          background: rgba(102, 126, 234, 0.2);
          color: #818cf8;
        }

        .filter-tab--active {
          background: linear-gradient(135deg, #113562 0%, #3db6e0 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
          transform: translateY(-1px);
        }

        .filter-tab:active {
          transform: translateY(0);
        }

        .filter-count {
          background: rgba(255, 255, 255, 0.2);
          color: inherit;
          border: 1px solid rgba(255, 255, 255, 0.3);
          font-weight: 600;
          min-width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .filter-tab--active .filter-count {
          background: rgba(255, 255, 255, 0.3);
          color: white;
        }

        /* Hide scrollbar for mobile */
        .process-filters::-webkit-scrollbar {
          display: none;
        }

        .process-filters {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        @media (max-width: 768px) {
          .process-filters {
            padding: 6px;
            margin-bottom: 16px;
          }

          .filter-tab {
            padding: 10px 16px;
            font-size: 13px;
          }

          .filter-tabs {
            gap: 6px;
          }
        }
      `}</style>
    </div>
  );
};

export default ProcessFilters;
