'use client';

import React from 'react';
import GlassCard from '../ui/GlassCard';

interface ProcessSkeletonProps {
  count?: number;
  className?: string;
}

const ProcessSkeleton: React.FC<ProcessSkeletonProps> = ({ count = 1, className = '' }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <GlassCard
          key={index}
          className={`process-skeleton ${className}`}
          hoverable={false}
          interactive={false}
          padding='lg'
        >
          {/* Header skeleton */}
          <div className='skeleton-header'>
            <div className='skeleton-icon'></div>
            <div className='skeleton-title-section'>
              <div className='skeleton-title'></div>
              <div className='skeleton-badge'></div>
            </div>
          </div>

          {/* Description skeleton */}
          <div className='skeleton-description'>
            <div className='skeleton-line'></div>
            <div className='skeleton-line'></div>
            <div className='skeleton-line skeleton-line--short'></div>
          </div>

          {/* Actions skeleton */}
          <div className='skeleton-actions'>
            <div className='skeleton-button'></div>
            <div className='skeleton-button'></div>
          </div>

          {/* Subprocesses skeleton */}
          <div className='skeleton-subprocesses'>
            <div className='skeleton-subprocesses-header'>
              <div className='skeleton-line skeleton-line--short'></div>
            </div>
            <div className='skeleton-subprocesses-list'>
              <div className='skeleton-tag'></div>
              <div className='skeleton-tag'></div>
              <div className='skeleton-tag'></div>
            </div>
          </div>

          {/* Metadata skeleton */}
          <div className='skeleton-metadata'>
            <div className='skeleton-line skeleton-line--short'></div>
            <div className='skeleton-line skeleton-line--short'></div>
          </div>

          <style jsx>{`
            .process-skeleton {
              height: 100%;
              display: flex;
              flex-direction: column;
              gap: 16px;
            }

            .skeleton-header {
              display: flex;
              align-items: flex-start;
              gap: 12px;
            }

            .skeleton-icon {
              width: 32px;
              height: 32px;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 8px;
            }

            .skeleton-title-section {
              flex: 1;
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            }

            .skeleton-title {
              height: 24px;
              width: 60%;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 4px;
              margin-bottom: 8px;
            }

            .skeleton-badge {
              height: 20px;
              width: 60px;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 12px;
            }

            .skeleton-description {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }

            .skeleton-line {
              height: 16px;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 4px;
            }

            .skeleton-line--short {
              width: 80%;
            }

            .skeleton-actions {
              display: flex;
              gap: 8px;
            }

            .skeleton-button {
              height: 32px;
              width: 100px;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 6px;
            }

            .skeleton-subprocesses {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }

            .skeleton-subprocesses-header {
              margin-bottom: 8px;
            }

            .skeleton-subprocesses-list {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
            }

            .skeleton-tag {
              height: 24px;
              width: 80px;
              background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
              background-size: 200% 100%;
              animation: loading 1.5s infinite;
              border-radius: 6px;
            }

            .skeleton-metadata {
              display: flex;
              gap: 16px;
              margin-top: auto;
              padding-top: 12px;
              border-top: 1px solid rgba(0, 0, 0, 0.05);
            }

            @keyframes loading {
              0% {
                background-position: 200% 0;
              }
              100% {
                background-position: -200% 0;
              }
            }

            @media (max-width: 768px) {
              .process-skeleton {
                gap: 12px;
                padding: 20px;
              }

              .skeleton-title {
                width: 70%;
              }

              .skeleton-button {
                width: 80px;
              }
            }
          `}</style>
        </GlassCard>
      ))}
    </>
  );
};

export default ProcessSkeleton;
