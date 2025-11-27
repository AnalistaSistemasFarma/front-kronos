'use client';

import React from 'react';

const AnimatedBackground: React.FC = () => {
  return (
    <>
      {/* Background with animated gradient */}
      <div className='animated-background' />

      {/* Animated background shapes */}
      <div className='bg-shapes'>
        <div className='shape shape-1'></div>
        <div className='shape shape-2'></div>
        <div className='shape shape-3'></div>
        <div className='shape shape-4'></div>
      </div>

      <style jsx>{`
        .animated-background {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, #113562 0%, #3db6e0 50%, #3db6e0 100%);
          z-index: -2;
        }

        .bg-shapes {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: -1;
          overflow: hidden;
        }

        .shape {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(5px);
        }

        .shape-1 {
          width: 300px;
          height: 300px;
          top: -150px;
          right: -100px;
          animation: float 15s infinite ease-in-out;
        }

        .shape-2 {
          width: 200px;
          height: 200px;
          bottom: -100px;
          left: -50px;
          animation: float 12s infinite ease-in-out reverse;
        }

        .shape-3 {
          width: 150px;
          height: 150px;
          top: 50%;
          left: 10%;
          animation: pulse 8s infinite ease-in-out;
        }

        .shape-4 {
          width: 100px;
          height: 100px;
          top: 20%;
          right: 15%;
          animation: float 10s infinite ease-in-out 2s;
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(5deg);
          }
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 0.2;
            transform: scale(1.1);
          }
        }

        @media (max-width: 768px) {
          .shape-1,
          .shape-2 {
            width: 200px;
            height: 200px;
          }

          .shape-3,
          .shape-4 {
            width: 100px;
            height: 100px;
          }
        }

        @media (max-width: 480px) {
          .shape-1,
          .shape-2 {
            width: 150px;
            height: 150px;
          }

          .shape-3,
          .shape-4 {
            width: 80px;
            height: 80px;
          }
        }
      `}</style>
    </>
  );
};

export default AnimatedBackground;
