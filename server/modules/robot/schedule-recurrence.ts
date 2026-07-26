import {
  computeScheduleRange,
  findScheduleDateExpression,
  resolveScheduleDate,
} from './schedule-time';

export interface ScheduleRecurrence {
  rrule: string;
  label: string;
  dateText: string;
}

export type ScheduleRecurrenceScope = 'single' | 'future' | 'all';

const CHINESE_NUMBER: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseScheduleRecurrence(
  sourceText: string,
  reference: Date = new Date(),
  startText = '上午',
): ScheduleRecurrence | null {
  const annual = /每\s*年/.test(sourceText);
  const monthly = sourceText.match(
    /每\s*(?:(\d{1,3}|[一二两三四五六七八九十]+)\s*个?)?月/,
  );
  if (!annual && !monthly) return null;
  if (annual && monthly) {
    throw new Error('一次只能设置一种重复周期');
  }

  if (annual) {
    const date = sourceText.match(
      /(?:(\d{2}|\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/,
    );
    if (!date) throw new Error('每年重复日程需要明确月份和日期');
    const month = Number(date[2]);
    const day = Number(date[3]);
    const suppliedYear = date[1]
      ? date[1].length === 2
        ? 2000 + Number(date[1])
        : Number(date[1])
      : null;
    let year = suppliedYear ?? shanghaiYear(reference);
    let dateText = `${year}年${month}月${day}日`;
    resolveScheduleDate(dateText, reference);
    if (!suppliedYear) {
      try {
        computeScheduleRange(dateText, startText || '上午', '', 60, reference);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('已经过去')) {
          throw error;
        }
        year += 1;
        dateText = `${year}年${month}月${day}日`;
        resolveScheduleDate(dateText, reference);
      }
    }
    return {
      rrule: 'FREQ=YEARLY;INTERVAL=1',
      label: `每年${month}月${day}日`,
      dateText,
    };
  }

  const interval = monthly?.[1] ? parseInterval(monthly[1]) : 1;
  const date = findScheduleDateExpression(sourceText);
  if (!date) {
    throw new Error('按月重复日程需要明确首次日期，例如“7月28日每三个月交房租”');
  }
  return {
    rrule: `FREQ=MONTHLY;INTERVAL=${interval}`,
    label: `每${interval}个月`,
    dateText: date.text,
  };
}

export function describeScheduleRecurrence(
  rrule: string | undefined,
  startTime?: Date,
): string | undefined {
  if (!rrule) return undefined;
  const frequency = rrule.match(/(?:^|;)FREQ=([A-Z]+)/)?.[1];
  const interval = Number(rrule.match(/(?:^|;)INTERVAL=(\d+)/)?.[1] || 1);
  if (frequency === 'MONTHLY') return `每${interval}个月`;
  if (frequency === 'YEARLY') {
    if (!startTime) return '每年';
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(startTime);
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return month && day ? `每年${month}月${day}日` : '每年';
  }
  return '重复日程';
}

export function stripScheduleRecurrence(text: string): string {
  return text
    .replace(/每\s*年/g, '')
    .replace(/每\s*(?:(?:\d{1,3}|[一二两三四五六七八九十]+)\s*个?)?月/g, '')
    .replace(
      /(?:(?:\d{2}|\d{4})\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g,
      '',
    )
    .replace(/\d{1,2}\s*[日号]/g, '')
    .replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/g, '')
    .trim();
}

export function hasScheduleRecurrenceScope(text: string): boolean {
  return parseScheduleRecurrenceScope(text) !== null;
}

export function parseScheduleRecurrenceScope(
  text: string,
): ScheduleRecurrenceScope | null {
  if (
    /此次及后续|本次及后续|这次及以后|本次以后|从(?:这|本)次(?:开始|以后)|后面的/.test(
      text,
    )
  ) {
    return 'future';
  }
  if (/全部|所有|每次|整个系列|整组/.test(text)) return 'all';
  if (/仅此次|仅本次|只(?:改|删除|删|取消)?这一次|只(?:改|删除|删|取消)?本次/.test(text)) {
    return 'single';
  }
  return null;
}

export function recurringMasterEventId(
  eventId: string,
  recurringEventId?: string,
): string {
  if (recurringEventId) return recurringEventId;
  const marker = eventId.lastIndexOf('_');
  return marker > 0 ? `${eventId.slice(0, marker)}_0` : eventId;
}

export function truncateScheduleRecurrence(
  rrule: string,
  selectedStart: Date,
): string {
  const until = formatRruleUtc(new Date(selectedStart.getTime() - 1000));
  return `${rrule
    .split(';')
    .filter((part) => !part.startsWith('UNTIL='))
    .join(';')};UNTIL=${until}`;
}

function formatRruleUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function parseInterval(value: string): number {
  const interval = /^\d+$/.test(value)
    ? Number(value)
    : parseChineseNumber(value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 120) {
    throw new Error('重复月数必须是 1 至 120 之间的整数');
  }
  return interval;
}

function parseChineseNumber(value: string): number {
  if (value === '十') return 10;
  if (!value.includes('十')) {
    return CHINESE_NUMBER[value] ?? Number.NaN;
  }
  const [tensText, onesText] = value.split('十');
  const tens = tensText ? CHINESE_NUMBER[tensText] : 1;
  const ones = onesText ? CHINESE_NUMBER[onesText] : 0;
  if (!tens || ones === undefined) return Number.NaN;
  return tens * 10 + ones;
}

function shanghaiYear(reference: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(reference),
  );
}
