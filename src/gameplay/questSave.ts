import { GOODS, PORTS, REPUTATION_NATIONS } from '../world';
import type { Quest, QuestKind } from './quests';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const KINDS: readonly QuestKind[] = ['delivery', 'courier', 'hunt'];
/** Most errands a save may carry (the game never has more than `QUESTS.maxActive`). */
const MOST = 3;

/**
 * Turn whatever a file holds as `quests` into valid errands: an unknown kind, port, good or nation drops the errand,
 * every number is clamped, and no more than the game could have given out are kept.
 */
export function sanitizeQuests(raw: unknown): Quest[] {
  if (!Array.isArray(raw)) return [];
  const ports = new Set(PORTS.map((p) => p.id));
  const goods = new Set(GOODS.map((g) => g.id));
  const out: Quest[] = [];
  for (const q of raw) {
    if (out.length >= MOST) break;
    if (!isRecord(q) || typeof q.id !== 'string' || q.id.length > 60) continue;
    const kind = KINDS.find((k) => k === q.kind);
    if (!kind || typeof q.from !== 'string' || typeof q.to !== 'string' || !ports.has(q.from) || !ports.has(q.to)) continue;
    if (typeof q.repNation !== 'string' || !REPUTATION_NATIONS.includes(q.repNation)) continue;
    const quest: Quest = { id: q.id, kind, from: q.from, to: q.to, reward: Math.floor(num(q.reward, 0, 0, 1e7)), repNation: q.repNation, repGain: Math.floor(num(q.repGain, 0, 0, 20)) };
    if (kind === 'delivery') {
      if (typeof q.good !== 'string' || !goods.has(q.good)) continue;
      quest.good = q.good;
      quest.qty = Math.floor(num(q.qty, 1, 1, 5000));
    }
    if (kind === 'hunt') {
      if (typeof q.nation !== 'string' || !REPUTATION_NATIONS.includes(q.nation)) continue;
      quest.nation = q.nation;
      quest.count = Math.floor(num(q.count, 1, 1, 20));
      quest.progress = Math.floor(num(q.progress, 0, 0, quest.count));
    }
    if (typeof q.deadline === 'number' && Number.isFinite(q.deadline)) quest.deadline = Math.max(0, q.deadline);
    out.push(quest);
  }
  return out;
}
