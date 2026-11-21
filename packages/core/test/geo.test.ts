import { describe, expect, it } from 'vitest';
import { columnName, formatGameTime, gridReference, isNight } from '../src/geo.ts';

describe('geo', () => {
  it('names columns like spreadsheet columns', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
  });

  it('computes grid references from the top-left', () => {
    expect(gridReference(0, 3500, 3500)).toBe('A0');
    expect(gridReference(150, 3500 - 150, 3500)).toBe('B1');
    // 3500 m map: 23 full cells; the strip past the last full cell joins it.
    expect(gridReference(3499, 1, 3500)).toBe('W22');
    expect(gridReference(-1, 10, 3500)).toBeNull();
  });

  it('formats in-game time', () => {
    expect(formatGameTime(13.5)).toBe('13:30');
    expect(formatGameTime(0)).toBe('00:00');
    expect(formatGameTime(23.999)).toBe('00:00');
    expect(formatGameTime(7.25)).toBe('07:15');
  });

  it('detects night', () => {
    expect(isNight(12, 7.5, 19.75)).toBe(false);
    expect(isNight(20, 7.5, 19.75)).toBe(true);
    expect(isNight(3, 7.5, 19.75)).toBe(true);
  });
});
