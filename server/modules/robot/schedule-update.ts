import {
  findScheduleDateExpression,
  findScheduleTimeExpressions,
} from './schedule-time';
import {
  extractScheduleMatterText,
  sourceScheduleColor,
} from './schedule-title';

export interface ScheduleUpdateIntent {
  target: {
    dateText: string;
    timeText: string;
    title: string;
  };
  changes: {
    dateText: string;
    timeText: string;
    title: string;
    titleMode?: 'append';
  };
}

const CHANGE_MARKER =
  /改名为|标题(?:修改|调整|改)?为|事项(?:修改|调整|改)?为|时间(?:修改|调整|改)?(?:为|到)|改到|调整到|修改到|改成|修改为|调整为|改为/;
const RENAME_MARKER = /改名为|标题(?:修改|调整|改)?为|事项(?:修改|调整|改)?为/;

export function parseScheduleUpdateIntent(
  sourceText: string,
  fallbackTitle = '',
): ScheduleUpdateIntent {
  const marker = findChangeMarker(sourceText);
  const markerIndex = marker?.index ?? sourceText.length;
  const before = sourceText.slice(0, markerIndex);
  const after = marker
    ? sourceText.slice(markerIndex + marker.value.length)
    : '';
  const beforeDate = findScheduleDateExpression(before)?.text || '';
  const afterDate = findScheduleDateExpression(after)?.text || '';
  const beforeTime = findScheduleTimeExpressions(before)[0]?.text || '';
  const afterTime = findScheduleTimeExpressions(after)[0]?.text || '';
  const targetTitle =
    cleanTargetTitle(before, beforeDate, beforeTime) || fallbackTitle;
  const matter = marker ? extractScheduleMatterText(after) : '';
  const changeTitle = /^(?:正式|转为?正式|确定为正式|不再暂定)$/.test(matter)
    ? ''
    : matter;
  const appendTitle =
    !!changeTitle &&
    !!(
      afterDate ||
      afterTime ||
      sourceScheduleColor(after) ||
      /(?:地点|位置|地址)\s*[:：]|提前|提醒/.test(after)
    ) &&
    !RENAME_MARKER.test(marker?.value || '') &&
    !compactTitle(changeTitle).includes(compactTitle(targetTitle));
  return {
    target: {
      dateText: beforeDate,
      timeText: beforeTime,
      title: targetTitle,
    },
    changes: {
      dateText: afterDate,
      timeText: afterTime,
      title: changeTitle,
      ...(appendTitle ? { titleMode: 'append' as const } : {}),
    },
  };
}

function findChangeMarker(sourceText: string) {
  const explicit = sourceText.match(CHANGE_MARKER);
  if (explicit) {
    return {
      value: explicit[0],
      index: explicit.index ?? sourceText.length,
    };
  }
  for (const match of sourceText.matchAll(/改/g)) {
    const index = match.index ?? 0;
    if (sourceText[index - 1] === '修') continue;
    const after = sourceText.slice(index + 1);
    if (
      findScheduleDateExpression(after) ||
      findScheduleTimeExpressions(after).length > 0
    ) {
      return { value: '改', index };
    }
  }
  return null;
}

function cleanTargetTitle(value: string, dateText: string, timeText: string) {
  return extractScheduleMatterText(
    value
      .replace(/^(?:请|麻烦)?\s*(?:把|将|修改|调整)\s*/, '')
      .replace(dateText, '')
      .replace(timeText, '')
      .replace(
        /(?:仅此次|仅本次|本次及后续|此次及后续|全部|所有|每次|整个系列|整组)\s*$/g,
        '',
      )
      .replace(/(?:的)?(?:日程|安排|事项)\s*$/g, '')
      .replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/g, '')
      .trim(),
  );
}

function compactTitle(value: string) {
  return value.replace(/\s+/g, '');
}

export function resolveScheduleUpdateTitle(
  original: string,
  changes: ScheduleUpdateIntent['changes'],
) {
  if (!changes.title) return original;
  if (changes.titleMode !== 'append') return changes.title;
  return compactTitle(original).includes(compactTitle(changes.title))
    ? original
    : `${original} ${changes.title}`;
}
