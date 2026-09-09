/**
 * Level / XP maths. The curve itself lives in content/progression.json so it can
 * be retuned without touching either runtime.
 */
import type { ProgressionConfig } from './types';

/** Highest level whose cumulative XP requirement is met. */
export function levelForXp(config: ProgressionConfig, xp: number): number {
  const table = config.xpTable;
  let level = 1;
  for (let i = 1; i < table.length; i++) {
    if (xp >= (table[i] ?? Infinity)) level = i + 1;
    else break;
  }
  return Math.min(level, config.maxLevel);
}

/** Cumulative XP at which `level` begins. */
export function xpAtLevelStart(config: ProgressionConfig, level: number): number {
  return config.xpTable[Math.max(0, level - 1)] ?? 0;
}

/** Cumulative XP needed for the next level, or null at max level. */
export function xpAtNextLevel(config: ProgressionConfig, level: number): number | null {
  if (level >= config.maxLevel) return null;
  return config.xpTable[level] ?? null;
}

/** Fractional progress through the current level, 0..1. Max level reads as full. */
export function levelProgress(config: ProgressionConfig, xp: number, level: number): number {
  const start = xpAtLevelStart(config, level);
  const next = xpAtNextLevel(config, level);
  if (next === null) return 1;
  const span = next - start;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (xp - start) / span));
}
