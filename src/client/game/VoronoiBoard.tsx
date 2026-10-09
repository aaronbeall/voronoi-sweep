import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { FaFlag } from 'react-icons/fa';
import clsx from 'clsx';
import { IoSkullSharp } from 'react-icons/io5';

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

const pickPoints = (count: number, minDist: number, rng: () => number, width: number, height: number): Point[] => {
  const pts: Point[] = [];
  let guard = 0;
  let currentMin = minDist;
  while (pts.length < count && guard < 12000) {
    const p = { x: rng() * width, y: rng() * height };
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

const createBoard = (seed: number, width: number, height: number): Tile[] => {
  const rng = mulberry32(seed);
  const points = pickPoints(TILE_TARGET, MIN_SEPARATION, rng, width, height);
  const polygons: Point[][] = [];

  for (let i = 0; i < points.length; i++) {
    let poly: Point[] = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
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

// Physics state for each point: displacement from anchor and velocity
type PhysicsPoint = {
  x: number; // current position
  y: number;
  vx: number; // velocity
  vy: number;
  ax: number; // anchor (resting position)
  ay: number;
};

export const VoronoiBoard = ({ seed, onState, onGameEnd }: VoronoiBoardProps) => {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [status, setStatus] = useState<GameStatus>('playing');
  const [moves, setMoves] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: BOARD_W, h: BOARD_H });

  // Physics simulation: display points that diverge from anchors
  const physicsRef = useRef<PhysicsPoint[]>([]);
  const [displayPoints, setDisplayPoints] = useState<Point[]>([]);

  // Mouse state for proximity repulsion
  const mouseRef = useRef<Point>({ x: -9999, y: -9999 });

  // Ripple waves: { originX, originY, createdAt }
  const ripplesRef = useRef<Array<{ ox: number; oy: number; t: number }>>([]);
  // Measure parent size and set dynamic board dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.max(60, Math.round(width));
      const h = Math.max(60, Math.round(height));
      setDims({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track mouse position for interactive repulsion
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Map from client coords to SVG viewBox coords
      const x = (clientX / rect.width) * dims.w;
      const y = (clientY / rect.height) * dims.h;

      mouseRef.current = { x, y };
    };

    svg.addEventListener('mousemove', handleMouseMove);
    return () => svg.removeEventListener('mousemove', handleMouseMove);
  }, [dims.w, dims.h]);

  // Handle SVG click for ripple effect
  const handleSVGClick = (e: MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const x = (clientX / rect.width) * dims.w;
    const y = (clientY / rect.height) * dims.h;

    // Add ripple at this point
    ripplesRef.current.push({ ox: x, oy: y, t: Date.now() });
  };

  // Build board whenever seed or dimensions change
  useEffect(() => {
    const newTiles = createBoard(seed, dims.w, dims.h);
    setTiles(newTiles);
    setStatus('playing');
    setMoves(0);

    // Initialize physics points to anchor at tile seeds
    physicsRef.current = newTiles.map((tile) => ({
      x: tile.seed.x,
      y: tile.seed.y,
      vx: 0,
      vy: 0,
      ax: tile.seed.x,
      ay: tile.seed.y,
    }));
    setDisplayPoints(newTiles.map((t) => t.seed));
  }, [seed, dims.w, dims.h]);

  // Physics animation loop: updates display points based on forces
  useEffect(() => {
    let rafId: number;

    const animate = () => {
      const physics = physicsRef.current;
      if (!tiles.length || !physics.length) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      const now = Date.now();
      const dt = 0.016; // ~60fps time step in seconds
      const mouseProxRadius = Math.min(dims.w, dims.h) * 0.15; // ~15% of board size
      const mouseRepelForce = 80; // strength of mouse repulsion
      const rippleSpeed = 120; // units per second
      const rippleForce = 120; // force magnitude at ripple center
      const rippeleDuration = 1200; // ms before ripple fades
      const springK = 12; // spring stiffness (return to anchor)
      const damping = 0.82; // velocity damping (friction)
      const maxVel = 40; // clamp velocity

      physics.forEach((pt) => {
        let fx = 0;
        let fy = 0;

        // Spring force back to anchor
        const dx = pt.ax - pt.x;
        const dy = pt.ay - pt.y;
        fx += dx * springK;
        fy += dy * springK;

        // Mouse proximity repulsion
        const dmx = pt.x - mouseRef.current.x;
        const dmy = pt.y - mouseRef.current.y;
        const dMouse = Math.hypot(dmx, dmy);
        if (dMouse < mouseProxRadius && dMouse > 1) {
          const repelMag = (1 - dMouse / mouseProxRadius) * mouseRepelForce;
          const nx = dmx / dMouse;
          const ny = dmy / dMouse;
          fx += nx * repelMag;
          fy += ny * repelMag;
        }

        // Ripple forces with distance-based delays
        ripplesRef.current.forEach((ripple) => {
          const elapsed = (now - ripple.t) / 1000; // seconds
          const rippleRadius = rippleSpeed * elapsed;
          const drx = pt.x - ripple.ox;
          const dry = pt.y - ripple.oy;
          const dr = Math.hypot(drx, dry);

          // Ripple wave: apply force to points near the wavefront, with delay based on distance
          const rippleWidth = 20; // width of the ripple band
          if (dr > 5 && dr < rippleRadius + rippleWidth) {
            // Distance-based delay: ripple reaches this point after dr/rippleSpeed seconds
            const pointDelay = dr / rippleSpeed;
            const age = elapsed - pointDelay;

            // Bell curve: force is strongest at the wavefront, decays quickly
            if (age > 0 && age < rippleWidth / rippleSpeed) {
              const strength = Math.cos((age / (rippleWidth / rippleSpeed)) * Math.PI * 0.5);
              const mag = strength * rippleForce;
              const nx = drx / dr;
              const ny = dry / dr;
              fx += nx * mag;
              fy += ny * mag;
            }
          }
        });

        // Update velocity with damping
        pt.vx = (pt.vx + fx * dt) * damping;
        pt.vy = (pt.vy + fy * dt) * damping;

        // Clamp velocity
        const vMag = Math.hypot(pt.vx, pt.vy);
        if (vMag > maxVel) {
          pt.vx = (pt.vx / vMag) * maxVel;
          pt.vy = (pt.vy / vMag) * maxVel;
        }

        // Update position
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;

        // Clamp to board bounds with a small margin
        const margin = 2;
        pt.x = Math.max(margin, Math.min(dims.w - margin, pt.x));
        pt.y = Math.max(margin, Math.min(dims.h - margin, pt.y));
      });

      // Remove old ripples
      ripplesRef.current = ripplesRef.current.filter((r) => now - r.t < rippeleDuration);

      // Update display points state (triggers re-render)
      setDisplayPoints(physics.map((p) => ({ x: p.x, y: p.y })));

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [tiles.length, dims.w, dims.h]);

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

  // Compute polygons for display points (for rendering)
  // Map each display point back to its tile and use display point for Voronoi generation
  const renderPolygons = useMemo(() => {
    if (!displayPoints.length || !tiles.length) return [];

    const bBox = { minX: 0, minY: 0, maxX: dims.w, maxY: dims.h };
    const polys: Point[][] = [];

    displayPoints.forEach((pt, i) => {
      let poly: Point[] = [
        { x: bBox.minX, y: bBox.minY },
        { x: bBox.maxX, y: bBox.minY },
        { x: bBox.maxX, y: bBox.maxY },
        { x: bBox.minX, y: bBox.maxY },
      ];

      // Clip against all other display points
      for (let j = 0; j < displayPoints.length; j++) {
        if (i === j) continue;
        const other = displayPoints[j]!;
        const mx = (pt.x + other.x) / 2;
        const my = (pt.y + other.y) / 2;
        const dx = other.x - pt.x;
        const dy = other.y - pt.y;
        // Half-plane equation: points closer to pt satisfy dx*(x-mx) + dy*(y-my) <= 0
        poly = clipHalfPlane(poly, dx, dy, dx * mx + dy * my);
        if (!poly.length) break;
      }

      polys.push(poly);
    });

    return polys;
  }, [displayPoints, tiles.length, dims.w, dims.h]);

  // Compute centroids for display polygons (for icon positioning)
  const displayCentroids = useMemo(() => {
    return renderPolygons.map((poly) => {
      if (!poly.length) return { x: 0, y: 0 };
      const x = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
      const y = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
      return { x, y };
    });
  }, [renderPolygons]);

  const palette = (tile: Tile) => {
    const x = tile.centroid.x / dims.w;
    const y = tile.centroid.y / dims.h;
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
    <div ref={containerRef} className="w-full h-full">
      <svg
        ref={svgRef}
        onClick={handleSVGClick}
        key={seed}
        className="w-full h-full"
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
      <defs>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6de0ff" stopOpacity="0.22" />
          <stop offset="70%" stopColor="#d868ff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f9f871" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={dims.w} height={dims.h} fill="url(#glow)" rx={4} />
      
      {DEBUG && displayPoints.map((pt, i) => (
        <circle
          key={`display-seed-${i}`}
          cx={pt.x}
          cy={pt.y}
          r={0.8}
          fill={tiles[i]?.mine ? 'red' : 'cyan'}
          opacity={0.5}
        />
      ))}
      
      {tiles.map((tile) => {
        const displayPoly = renderPolygons[tile.id] || [];
        const colors = palette(tile);
        const isFlagged = tile.state === 'flagged';
        const isHidden = tile.state === 'hidden';
        const isRevealed = tile.state === 'revealed' || tile.state === 'exploded';
        // UI scale based on dynamic board size (baseline 120)
        const ui = Math.max(1, Math.min(dims.w, dims.h) / 200);
        
        const getDotColor = (count: number) => {
          if (count === 1) return '#fbbf24'; // yellow
          if (count === 2) return '#fb923c'; // orange
          if (count === 3) return '#ef4444'; // red
          return '#dc2626'; // deep red for 4+
        };
        
        const renderDots = (count: number, cx: number, cy: number) => {
          const dotColor = getDotColor(count);
          const radius = 1.8 * ui;
          const spacing = 3.8 * ui;
          
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
              points={displayPoly.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={1}
            />
            <polygon
              points={displayPoly.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="url(#glow)"
              opacity={0.3}
            />
            {isFlagged && (
              <g
                className="select-none pointer-events-none"
                transform={`translate(${displayCentroids[tile.id]?.x || tile.centroid.x}, ${displayCentroids[tile.id]?.y || tile.centroid.y})`}
                style={{ filter: 'drop-shadow(0 0 3px rgba(255,80,80,0.6)) drop-shadow(0 0 6px rgba(255,80,80,0.4))' }}
              >
                <g transform={`translate(${-Math.round(10 * ui) / 2}, ${-Math.round(10 * ui) / 2})`}>
                  <FaFlag size={Math.round(10 * ui)} color={'#fff7d6'} />
                </g>
              </g>
            )}
            {isRevealed && !isFlagged && (
              <>
                {tile.mine ? (
                  <g
                    className="select-none pointer-events-none"
                    transform={`translate(${displayCentroids[tile.id]?.x || tile.centroid.x}, ${displayCentroids[tile.id]?.y || tile.centroid.y})`}
                    style={{ filter: 'drop-shadow(0 0 3px #ef4444) drop-shadow(0 0 6px #ef4444)' }}
                  >
                    <g transform={`translate(${-Math.round(14 * ui) / 2}, ${-Math.round(14 * ui) / 2})`}>
                      <IoSkullSharp size={Math.round(14 * ui)} color={'#0b0b0f'} />
                    </g>
                  </g>
                ) : tile.count > 0 ? (
                  <g className="select-none pointer-events-none">
                    {renderDots(tile.count, displayCentroids[tile.id]?.x || tile.centroid.x, displayCentroids[tile.id]?.y || tile.centroid.y)}
                  </g>
                ) : null}
              </>
            )}
          </g>
        );
      })}
      </svg>
    </div>
  );
};
