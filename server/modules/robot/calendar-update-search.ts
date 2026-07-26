import type { ChineseScheduleParseOneOutput } from '@shared/plugin-types';
import type { CalendarEventRecord } from './feishu.service';
import type { NormalizedScheduleCommand } from './schedule-command';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 20;

export interface StoredCalendarUpdateRequest {
  sourceText: string;
  command: NormalizedScheduleCommand;
  raw: ChineseScheduleParseOneOutput;
  referenceTime: string;
}

export type UpdateSearchScope = 'primary' | 'extended';

export function updateSearchWindow(reference: Date, scope: UpdateSearchScope) {
  const boundary = new Date(reference.getTime() + 30 * DAY_MS);
  if (scope === 'primary') return { start: reference, end: boundary };
  const end = new Date(reference);
  end.setUTCFullYear(end.getUTCFullYear() + 2);
  return { start: boundary, end };
}

export function rankUpdateCandidates(
  events: CalendarEventRecord[],
  keyword: string,
  limit = MAX_CANDIDATES,
): CalendarEventRecord[] {
  const normalized = keyword.trim();
  if (!normalized) return [];
  const unique = [
    ...new Map(events.map((event) => [event.eventId, event])).values(),
  ];
  const exact = unique.filter((event) => event.summary.trim() === normalized);
  const matches = exact.length
    ? exact
    : unique.filter((event) => event.summary.includes(normalized));
  return matches
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime())
    .slice(0, limit);
}

export function parseSingleUpdateSelection(
  text: string,
  candidateCount: number,
): number {
  const value = text.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error('修改日程时只能选择一个序号');
  }
  const index = Number(value);
  if (index < 1 || index > candidateCount) {
    throw new Error(`序号必须在1-${candidateCount}之间`);
  }
  return index - 1;
}
