import '../index.css';

import { navigateTo } from '@devvit/web/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  const name = context.username ?? 'Explorer';
  const polys = [
    '10,15 35,8 55,14 50,32 25,30',
    '60,10 85,18 78,34 58,30',
    '12,40 30,35 50,42 44,58 18,60',
    '58,40 82,42 90,62 68,66 56,52',
    '20,72 44,68 54,82 32,90',
    '60,72 82,70 92,88 66,92',
  ];

  return (
    <div className="min-h-screen bg-surface text-sand relative overflow-hidden flex items-center justify-center">
      <svg
        aria-hidden
        className="absolute inset-0 w-full h-full opacity-50"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="lines" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7df5ff" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#ff82d7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffe072" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="transparent" />
        {polys.map((points, i) => (
          <polygon
            key={points}
            points={points}
            fill="none"
            stroke="url(#lines)"
            strokeWidth="0.6"
            opacity={0.6 - i * 0.07}
          />
        ))}
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(125,245,255,0.08),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(255,130,215,0.08),transparent_50%)]" />

      <div className="relative z-10 text-center px-6 max-w-2xl flex flex-col items-center gap-5">
        <p className="pill">Voronoi Sweeper</p>
        <h1 className="text-4xl md:text-5xl font-semibold leading-tight drop-shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
          Hey {name}, tap in and sweep the shards.
        </h1>
        <p className="text-muted text-base md:text-lg">
          Minimal, fast, and organic. Reveal counts, flag voids, clear the field.
        </p>
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <button
            className="btn text-base"
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            Enter Expanded Mode
          </button>
          <button
            className="text-muted underline-offset-4 hover:underline"
            onClick={() => navigateTo('https://developers.reddit.com/docs')}
          >
            Docs
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
