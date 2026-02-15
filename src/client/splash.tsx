import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="flex relative flex-col justify-center items-center min-h-screen gap-4 px-6">
      <h1 className="text-3xl font-bold text-center text-gray-900">Streak Club</h1>
      <p className="text-base text-center text-gray-700 max-w-md">
        Track daily check-ins, build streaks, and compete on the leaderboard.
      </p>
      <p className="text-sm text-center text-gray-500">
        Signed in as {context.username ?? 'anonymous'}
      </p>

      <button
        className="flex items-center justify-center bg-[#0f6fff] hover:bg-[#0c5ad0] text-white w-auto h-11 rounded-full cursor-pointer transition-colors px-5 font-semibold"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'app')}
      >
        Open Streak Dashboard
      </button>

      <p className="absolute bottom-4 text-xs text-gray-500">Daily reset: 00:00 UTC</p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
