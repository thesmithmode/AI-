import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  // Create 5 bars
  const bars = Array.from({ length: 5 });

  return (
    <div className="flex items-center justify-center gap-2 h-24">
      {bars.map((_, index) => {
        // Calculate a varied height based on volume and index to create a wave effect
        const baseHeight = 10;
        const variableHeight = isActive ? volume * 100 : 0;
        
        // Add some randomness/offset based on index for wave look
        const offset = Math.sin(index) * 10; 
        const height = Math.max(baseHeight, Math.min(100, variableHeight + (isActive ? offset : 0)));

        return (
          <div
            key={index}
            className={`w-4 rounded-full transition-all duration-100 ease-in-out ${
              isActive ? 'bg-indigo-500' : 'bg-gray-300'
            }`}
            style={{
              height: `${isActive ? Math.max(10, volume * 100 * (1 + Math.random() * 0.5)) : 10}%`,
              opacity: isActive ? 0.8 + (volume * 0.2) : 0.5
            }}
          />
        );
      })}
    </div>
  );
};

export default Visualizer;