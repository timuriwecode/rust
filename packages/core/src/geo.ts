/**
 * Map helpers: grid references ("G12") and in-game clock formatting.
 *
 * Rust+ map coordinates run from 0 to mapSize, origin in the bottom-left
 * corner. The in-game grid has square cells of about 146.3 m, columns
 * lettered A..Z, AA.. from the left, rows numbered from 0 at the top.
 */

export const GRID_CELL_SIZE = 146.28571428571428;

export function columnName(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/** Grid reference for a point, e.g. "G12". Returns null outside the map. */
export function gridReference(x: number, y: number, mapSize: number): string | null {
  if (mapSize <= 0 || x < 0 || y < 0 || x > mapSize || y > mapSize) return null;
  const cells = Math.floor(mapSize / GRID_CELL_SIZE);
  const col = Math.min(cells - 1, Math.floor(x / GRID_CELL_SIZE));
  const row = Math.min(cells - 1, Math.floor((mapSize - y) / GRID_CELL_SIZE));
  return `${columnName(col)}${row}`;
}

/** 13.5 -> "13:30". */
export function formatGameTime(hours: number): string {
  const total = Math.round((((hours % 24) + 24) % 24) * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isNight(time: number, sunrise: number, sunset: number): boolean {
  return time < sunrise || time >= sunset;
}
