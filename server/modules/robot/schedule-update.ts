import {
  findScheduleDateExpression,
  findScheduleTimeExpressions,
} from './schedule-time';

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
  };
}

const CHANGE_MARKER =
  /改名为|标题(?:修改|调整|改)?为|事项(?:修改|调整|改)?为|时间(?:修改|调整|改)?(?:为|到)|改到|调整到|修改到|改成|修改为|调整为|改为/;
const RENAME_MARKER = /改名为|标题(?:修改|调整|改)?为|事项(?:修改|调整|改)?为/;
const COLOR_VALUE = /^(?:红|橙|黄|绿|蓝|紫|灰)(?:色)?$/;

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
  const changeTitle = shouldTreatAsRename(
    marker?.value || '',
    after,
    afterDate,
    afterTime,
  )
    ? cleanNewTitle(after, afterDate, afterTime)
    : '';
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
  return value
    .replace(/^(?:请|麻烦)?\s*(?:把|将|修改|调整)\s*/, '')
    .replace(dateText, '')
    .replace(timeText, '')
    .replace(
      /(?:仅此次|仅本次|本次及后续|此次及后续|全部|所有|每次|整个系列|整组)\s*$/g,
      '',
    )
    .replace(/(?:的)?(?:日程|安排|事项)\s*$/g, '')
    .replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/g, '')
    .trim();
}

function cleanNewTitle(value: string, dateText: string, timeText: string) {
  return value
    .replace(dateText, '')
    .replace(timeText, '')
    .replace(/^[\s,，、:：-]+|[\s,，、:：。！!-]+$/g, '')
    .trim();
}

function shouldTreatAsRename(
  marker: string,
  after: string,
  dateText: string,
  timeText: string,
) {
  if (RENAME_MARKER.test(marker)) return true;
  const value = cleanNewTitle(after, dateText, timeText);
  return (
    !!value &&
    !dateText &&
    !timeText &&
    !COLOR_VALUE.test(value) &&
    !/^(?:地点|位置|提醒|提前)/.test(value)
  );
}
