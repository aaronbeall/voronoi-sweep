import { useMemo, useState } from 'react';
import clsx from 'clsx';

export type Point = { x: number; y: number };
export type TileState = 'hidden' | 'flagged' | 'revealed' | 'exploded';
export type GameStatus = 'playing' | 'won' | 'lost';

export type Tile = {
  id: number;
  seed: Point;
  centroid: Point;
  polygon: Point[];
  neighbors: number[];
  mine: boolean;
  state: TileState;
  count: number;
};

export type BoardSnapshot = {
  mines: number;
  flags: number;
  moves: number;
  status: GameStatus;
};

export const BOARD_W = 120;
export const BOARD_H = 120;
const TILE_TARGET = 44;
const MIN_SEPARATION = 9;
const MINE_RATIO = 0.22;
const DEBUG = false;

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t = Math.imul(t + 0x6d2b79f5, 1);
    t ^= t >>> 15;
    t = Math.imul(t | 1, t);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const pickPoints = (count: number, minDist: number, rng: () => number): Point[] => {
  const pts: Point[] = [];
  let guard = 0;
  let currentMin = minDist;
  while (pts.length < count && guard < 12000) {
    const p = { x: rng() * BOARD_W, y: rng() * BOARD_H };
    if (pts.every((q) => dist(p, q) > currentMin)) pts.push(p);
    guard += 1;
    if (guard % 2500 === 0 && currentMin > 4) currentMin -= 1; // relax if stuck
  }
  return pts;
};

// Clip polygon to half-plane using Sutherland-Hodgman algorithm: keep points where ax + by <= c
const clipHalfPlane = (poly: Point[], a: number, b: number, c: number): Point[] => {
  if (!poly.length) return [];
  const result: Point[] = [];
  
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i]!;
    const next = poly[(i + 1) % poly.length]!;
    
    const currDist = a * curr.x + b * curr.y - c;
    const nextDist = a * next.x + b * next.y - c;
    
    const currInside = currDist <= 1e-9;
    const nextInside = nextDist <= 1e-9;
    
    if (currInside && nextInside) {
      // Both inside: add next vertex
      result.push(next);
    } else if (currInside && !nextInside) {
      // Leaving: add intersection point
      const t = currDist / (currDist - nextDist);
      result.push({
        x: curr.x + t * (next.x - curr.x),
        y: curr.y + t * (next.y - curr.y),
      });
    } else if (!currInside && nextInside) {
      // Entering: add intersection point and next vertex
      const t = currDist / (currDist - nextDist);
      result.push({
        x: curr.x + t * (next.x - curr.x),
        y: curr.y + t * (next.y - curr.y),
      });
      result.push(next);
    }
    // Both outside: add nothing
  }
  
  return result;
};

const polygonCentroid = (points: Point[]): Point => {
  if (!points.length) return { x: 0, y: 0 };
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) return { x: points[0]!.x, y: points[0]!.y };
  return { x: cx / (6 * area), y: cy / (6 * area) };
};

const shareEdge = (a: Point[], b: Point[]) => {
  const eps = 1e-3;
  let shared = 0;
  for (const pa of a) {
    for (const pb of b) {
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < eps) {
        shared += 1;
        if (shared >= 2) return true;
      }
    }
  }
  return false;
};

const recomputeCounts = (tiles: Tile[]) => {
  for (const tile of tiles) {
    tile.count = tile.neighbors.reduce((acc, n) => acc + (tiles[n]!.mine ? 1 : 0), 0);
  }
};

const createBoard = (seed: number): Tile[] => {
  const rng = mulberry32(seed);
  const points = pickPoints(TILE_TARGET, MIN_SEPARATION, rng);
  const polygons: Point[][] = [];

  for (let i = 0; i < points.length; i++) {
    let poly: Point[] = [
      { x: 0, y: 0 },
      { x: BOARD_W, y: 0 },
      { x: BOARD_W, y: BOARD_H },
      { x: 0, y: BOARD_H },
    ];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const p = points[i]!;
      const q = points[j]!;
      // Perpendicular bisector: points closer to p than q
      // Half-plane: (q.x - p.x) * x + (q.y - p.y) * y <= (q.x² + q.y² - p.x² - p.y²) / 2
      const a = q.x - p.x;
      const b = q.y - p.y;
      const c = (q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y) / 2;
      poly = clipHalfPlane(poly, a, b, c);
      if (!poly.length) break;
    }
    polygons.push(poly);
  }

  const neighbors: number[][] = Array.from({ length: points.length }, () => []);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (shareEdge(polygons[i]!, polygons[j]!)) {
        neighbors[i]!.push(j);
        neighbors[j]! .push(i);
      }
    }
  }

  const mineTotal = Math.max(8, Math.round(points.length * MINE_RATIO));
  const mines = new Set<number>();
  while (mines.size < mineTotal) mines.add(Math.floor(rng() * points.length));

  const tiles: Tile[] = points.map((p, i) => ({
    id: i,
    seed: p,
    centroid: polygonCentroid(polygons[i]!),
    polygon: polygons[i]!,
    neighbors: neighbors[i]!,
    mine: mines.has(i),
    state: 'hidden',
    count: 0,
  }));

  recomputeCounts(tiles);
  return tiles;
};

const floodReveal = (tiles: Tile[], startId: number) => {
  const queue = [startId];
  while (queue.length) {
    const id = queue.pop();
    if (id === undefined) continue;
    const tile = tiles[id];
    if (!tile || tile.state === 'revealed' || tile.state === 'flagged') continue;
    tile.state = 'revealed';
    if (tile.count !== 0) continue;
    for (const n of tile.neighbors) {
      const neighbor = tiles[n];
      if (!neighbor || neighbor.mine || neighbor.state !== 'hidden') continue;
      queue.push(n);
    }
  }
};

const allClear = (tiles: Tile[]) => tiles.every((t) => t.mine || t.state === 'revealed');

type VoronoiBoardProps = {
  seed: number;
  onState: (snapshot: BoardSnapshot) => void;
  onGameEnd: (status: GameStatus) => void;
};

export const VoronoiBoard = ({ seed, onState, onGameEnd }: VoronoiBoardProps) => {
  const [tiles, setTiles] = useState<Tile[]>(() => createBoard(seed));
  const [status, setStatus] = useState<GameStatus>('playing');
  const [moves, setMoves] = useState(0);

  const mines = useMemo(() => tiles.filter((t) => t.mine).length, [tiles]);
  const flags = useMemo(() => tiles.filter((t) => t.state === 'flagged').length, [tiles]);

  const updateGameState = (newTiles: Tile[], newMoves: number) => {
    // Determine game status
    let newStatus: GameStatus = 'playing';
    if (newTiles.some((t) => t.state === 'exploded')) {
      newStatus = 'lost';
    } else if (allClear(newTiles)) {
      newStatus = 'won';
    }

    // Update all state at once
    setTiles(newTiles);
    setMoves(newMoves);
    if (newStatus !== 'playing') {
      setStatus(newStatus);
      onGameEnd(newStatus);
    }

    // Notify parent of state change
    const newMines = newTiles.filter((t) => t.mine).length;
    const newFlags = newTiles.filter((t) => t.state === 'flagged').length;
    onState({ mines: newMines, flags: newFlags, moves: newMoves, status: newStatus });
  };

  const flagTile = (id: number) => {
    if (status !== 'playing') return;
    const next = tiles.map((t) => ({ ...t }));
    const target = next[id];
    if (!target || target.state === 'revealed') return;
    // Prevent placing more flags than total mines
    if (target.state === 'hidden' && flags >= mines) return;
    target.state = target.state === 'flagged' ? 'hidden' : 'flagged';
    updateGameState(next, moves);
  };

  const revealTile = (id: number) => {
    if (status !== 'playing') return;
    const next = tiles.map((t) => ({ ...t }));
    const target = next[id];
    if (!target || target.state === 'flagged' || target.state === 'revealed') return;

    // First-move safety: relocate mine if first click hits one.
    if (target.mine && moves === 0) {
      target.mine = false;
      const safeSwap = next.find((t) => !t.mine && t.id !== target.id);
      if (safeSwap) safeSwap.mine = true;
      recomputeCounts(next);
    }

    if (target.mine) {
      target.state = 'exploded';
      for (const tile of next) {
        if (tile.mine && tile.id !== target.id) {
          tile.state = tile.state === 'flagged' ? 'flagged' : 'revealed';
        }
      }
      updateGameState(next, moves + 1);
      return;
    }

    floodReveal(next, target.id);
    updateGameState(next, moves + 1);
  };

  const palette = (tile: Tile) => {
    const x = tile.centroid.x / BOARD_W;
    const y = tile.centroid.y / BOARD_H;
    const blend = (x + y) / 2;
    
    if (tile.state === 'hidden') {
      // Dark blue to purple gradient for hidden tiles
      const hue = 220 + blend * 40; // 220-260 (blue to purple)
      return { fill: `hsl(${hue} 45% 22%)`, stroke: 'rgba(255,255,255,0.12)' };
    }
    if (tile.state === 'flagged') {
      // Reddish orange for flagged
      return { fill: 'hsl(15 90% 58%)', stroke: 'rgba(255,255,255,0.18)' };
    }
    if (tile.state === 'exploded') {
      // Bright red for exploded
      return { fill: 'hsl(0 85% 60%)', stroke: 'rgba(255,255,255,0.25)' };
    }
    // Revealed: teal to cyan gradient
    const hue = 170 + blend * 30; // 170-200 (teal to cyan)
    return { fill: `hsl(${hue} 55% 45%)`, stroke: 'rgba(255,255,255,0.25)' };
  };

  return (
    <svg key={seed} className="w-full h-[520px] md:h-[620px]" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} role="presentation">
      <defs>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6de0ff" stopOpacity="0.22" />
          <stop offset="70%" stopColor="#d868ff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f9f871" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill="url(#glow)" rx={4} />
      
      {DEBUG && tiles.map((tile) => (
        <circle
          key={`seed-${tile.id}`}
          cx={tile.seed.x}
          cy={tile.seed.y}
          r={0.8}
          fill={tile.mine ? 'red' : 'white'}
        />
      ))}
      
      {tiles.map((tile) => {
        const colors = palette(tile);
        const isFlagged = tile.state === 'flagged';
        const isHidden = tile.state === 'hidden';
        const isRevealed = tile.state === 'revealed' || tile.state === 'exploded';
        
        const getDotColor = (count: number) => {
          if (count === 1) return '#fbbf24'; // yellow
          if (count === 2) return '#fb923c'; // orange
          if (count === 3) return '#ef4444'; // red
          return '#dc2626'; // deep red for 4+
        };
        
        const renderDots = (count: number, cx: number, cy: number) => {
          const dotColor = getDotColor(count);
          const radius = 1.2;
          const spacing = 2.8;
          
          if (count === 1) {
            return <circle cx={cx} cy={cy} r={radius} fill={dotColor} />;
          } else if (count === 2) {
            return (
              <>
                <circle cx={cx - spacing/2} cy={cy} r={radius} fill={dotColor} />
                <circle cx={cx + spacing/2} cy={cy} r={radius} fill={dotColor} />
              </>
            );
          } else if (count === 3) {
            return (
              <>
                <circle cx={cx} cy={cy - spacing/2} r={radius} fill={dotColor} />
                <circle cx={cx - spacing/2} cy={cy + spacing/2} r={radius} fill={dotColor} />
                <circle cx={cx + spacing/2} cy={cy + spacing/2} r={radius} fill={dotColor} />
              </>
            );
          } else {
            return (
              <>
                <circle cx={cx - spacing/2} cy={cy - spacing/2} r={radius} fill={dotColor} />
                <circle cx={cx + spacing/2} cy={cy - spacing/2} r={radius} fill={dotColor} />
                <circle cx={cx - spacing/2} cy={cy + spacing/2} r={radius} fill={dotColor} />
                <circle cx={cx + spacing/2} cy={cy + spacing/2} r={radius} fill={dotColor} />
              </>
            );
          }
        };

        return (
          <g
            key={tile.id}
            className={clsx('tile', {
              'tile-hidden': isHidden,
              'tile-flagged': isFlagged,
              'tile-hit': tile.state === 'exploded',
              'tile-revealed': tile.state === 'revealed',
            })}
            onClick={() => revealTile(tile.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              flagTile(tile.id);
            }}
          >
            <polygon
              points={tile.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={1}
            />
            <polygon
              points={tile.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="url(#glow)"
              opacity={0.3}
            />
            {isFlagged && (
              <text
                x={tile.centroid.x}
                y={tile.centroid.y + 1.5}
                textAnchor="middle"
                className="select-none pointer-events-none"
                fill="#fff7d6"
                fontSize={7}
                fontWeight={700}
              >
                ⚑
              </text>
            )}
            {isRevealed && !isFlagged && (
              <>
                {tile.mine ? (
                  <text
                    x={tile.centroid.x}
                    y={tile.centroid.y + 2}
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                    fill="#0b0b0f"
                    fontSize={9}
                    fontWeight={700}
                    style={{ filter: 'drop-shadow(0 0 3px #ef4444) drop-shadow(0 0 6px #ef4444)' }}
                  >
                    💀
                  </text>
                ) : tile.count > 0 ? (
                  <g className="select-none pointer-events-none">
                    {renderDots(tile.count, tile.centroid.x, tile.centroid.y)}
                  </g>
                ) : null}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
};
