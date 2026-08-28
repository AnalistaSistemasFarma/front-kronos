'use client';

import React from 'react';

interface ProcessSkeletonProps {
  count?: number;
  className?: string;
}

const ProcessSkeleton: React.FC<ProcessSkeletonProps> = ({ count = 1, className = '' }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={`ios-process-card ${className}`} aria-hidden>
          <div className='ios-process-card__head'>
            <div
              className='ios-process-card__glyph'
              style={{ background: 'color-mix(in srgb, var(--app-text) 10%, transparent)' }}
            />
            <div style={{ flex: 1 }}>
              <div className='ios-skel' style={{ height: 18, width: '55%', marginBottom: 8 }} />
              <div className='ios-skel' style={{ height: 12, width: '32%' }} />
            </div>
          </div>
          <div className='ios-process-list' style={{ padding: 8 }}>
            <div className='ios-skel' style={{ height: 40, marginBottom: 8 }} />
            <div className='ios-skel' style={{ height: 40 }} />
          </div>
        </div>
      ))}
      <style jsx>{`
        .ios-skel {
          border-radius: 10px;
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--app-text) 8%, transparent) 25%,
            color-mix(in srgb, var(--app-text) 14%, transparent) 50%,
            color-mix(in srgb, var(--app-text) 8%, transparent) 75%
          );
          background-size: 200% 100%;
          animation: ios-skel 1.4s ease infinite;
        }
        @keyframes ios-skel {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </>
  );
};

export default ProcessSkeleton;
