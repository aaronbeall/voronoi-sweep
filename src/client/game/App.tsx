import { useCallback, useState } from 'react';
import { VoronoiBoard, type BoardSnapshot, type GameStatus } from './VoronoiBoard';

export const App = () => {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [status, setStatus] = useState<GameStatus>('playing');
  const [moves, setMoves] = useState(0);
  const [mines, setMines] = useState(0);
  const [flags, setFlags] = useState(0);

  const reset = useCallback(() => {
    setSeed(Math.floor(Math.random() * 1_000_000_000));
    setStatus('playing');
    setMoves(0);
    setFlags(0);
  }, []);

  const handleState = useCallback((snap: BoardSnapshot) => {
    setStatus(snap.status);
    setMoves(snap.moves);
    setMines(snap.mines);
    setFlags(snap.flags);
  }, []);

  const minesLeft = Math.max(0, mines - flags);

  const statusCopy = {
    playing: 'Sweep the shards, avoid the voids.',
    won: 'Flawless sweep! All voids flagged.',
    lost: 'The void consumed a tile. Try again.',
  }[status];

  return (
    <div className="min-h-screen h-screen bg-surface text-sand flex flex-col p-4 overflow-hidden">
      <div className="glass px-4 py-3 rounded-xl flex items-center justify-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="pill">Moves</span>
          <strong className="text-lg font-semibold">{moves}</strong>
        </div>
        <div className="w-px h-10 bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="pill">Mines</span>
          <strong className="text-lg font-semibold">{minesLeft}</strong>
        </div>
        <button className="btn" onClick={reset}>
          New Board
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center min-h-0">
        <div className="glass w-full h-full rounded-2xl overflow-hidden p-4 flex items-center justify-center">
          <VoronoiBoard key={seed} seed={seed} onState={handleState} onGameEnd={setStatus} />
        </div>

        {status !== 'playing' && (
          <div className="glass absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-4 rounded-xl flex items-center gap-4">
            <p className="text-sm text-muted">
              {statusCopy}
            </p>
            <button className="btn" onClick={reset}>
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
