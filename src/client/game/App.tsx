import { useCallback, useEffect, useRef, useState } from 'react';
import { FaSkullCrossbones, FaMousePointer, FaClock, FaTrophy, FaTimesCircle, FaRedo } from 'react-icons/fa';
import { VoronoiBoard, type BoardSnapshot, type GameStatus } from './VoronoiBoard';

const { setInterval } = window;

export const App = () => {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [status, setStatus] = useState<GameStatus>('playing');
  const [moves, setMoves] = useState(0);
  const [mines, setMines] = useState(0);
  const [flags, setFlags] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Timer logic: starts on first move, stops on game end
  useEffect(() => {
    if (status === 'playing' && moves > 0) {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      }
    } else if (status !== 'playing') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, moves]);

  const reset = useCallback(() => {
    if (moves > 0 && status === 'playing') {
      if (!confirm('Start a new board? Current progress will be lost.')) return;
    }
    setSeed(Math.floor(Math.random() * 1_000_000_000));
    setStatus('playing');
    setMoves(0);
    setFlags(0);
    setSeconds(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [moves, status]);

  const handleState = useCallback((snap: BoardSnapshot) => {
    setStatus(snap.status);
    setMoves(snap.moves);
    setMines(snap.mines);
    setFlags(snap.flags);
  }, []);

  const minesLeft = Math.max(0, mines - flags);
  const timeFormatted = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const statusCopy = {
    playing: 'Sweep the shards, avoid the voids.',
    won: 'Victory!',
    lost: 'You fail.',
  }[status];

  return (
    <div className="min-h-screen h-screen bg-surface text-sand flex flex-col overflow-hidden p-4">
      <div className="flex-1 flex flex-col gap-0 min-h-0">
        {/* Compact stats bar - attached to board top */}
        <div className="glass px-3 py-2 rounded-t-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <FaMousePointer className="text-cyan-400" size={14} />
              <span className="text-sm font-semibold tabular-nums">{moves}</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <FaSkullCrossbones className="text-red-400" size={14} />
              <span className="text-sm font-semibold tabular-nums">{minesLeft}</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <FaClock className="text-amber-400" size={14} />
              <span className="text-sm font-semibold tabular-nums">{timeFormatted}</span>
            </div>
          </div>
          <button
            className="p-2 rounded-lg text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors"
            onClick={reset}
            title="New Board"
          >
            <FaRedo size={14} />
          </button>
        </div>
        {/* Board - attached to stats */}
        <div className="glass flex-1 rounded-b-2xl overflow-hidden relative p-4">
          <VoronoiBoard key={seed} seed={seed} onState={handleState} onGameEnd={setStatus} />

          {status !== 'playing' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
              <div
                className={`glass backdrop-blur-md px-6 py-4 rounded-xl flex items-center gap-4 shadow-2xl ${
                  status === 'won'
                    ? 'border-2 border-emerald-500/50 shadow-emerald-500/30'
                    : 'border-2 border-red-500/50 shadow-red-500/30'
                }`}
              >
                {status === 'won' ? (
                  <FaTrophy className="text-amber-400" size={28} />
                ) : (
                  <FaSkullCrossbones className="text-red-500" size={28} />
                )}
                <div className="flex flex-col gap-2">
                  <p className="text-base font-semibold">{statusCopy}</p>
                  <div className="flex items-center gap-3 text-xs text-white/70">
                    <span className="flex items-center gap-1.5">
                      <FaMousePointer size={10} /> {moves}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FaClock size={10} /> {timeFormatted}
                    </span>
                  </div>
                </div>
                <button className="btn text-sm px-4 py-2" onClick={reset}>
                  Play Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
