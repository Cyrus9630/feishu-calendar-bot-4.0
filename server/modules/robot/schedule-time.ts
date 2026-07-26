import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
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

const WEEKDAY_INDEX: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
};

const RELATIVE_AMOUNT_PATTERN = '[零〇一二两三四五六七八九十\\d]{1,6}';
const RELATIVE_DATE_PATTERN = `${RELATIVE_AMOUNT_PATTERN}\\s*(?:个\\s*)?(?:小时|钟头|月|天|日)\\s*后`;

const DATE_EXPRESSION = new RegExp(
  [
    '今天',
    '今日',
    '明天',
    '明日',
    '大后天',
    '后天',
    RELATIVE_DATE_PATTERN,
    '(?:下下周|下下星期|下下礼拜|下周|下星期|下礼拜|本周|这周|本星期|这星期|本礼拜|这礼拜|周|星期|礼拜)[一二三四五六日天]',
    '(?:(?:20\\d{2}|\\d{2})\\s*[年/-]\\s*)?\\d{1,2}\\s*[月/-]\\s*\\d{1,2}\\s*[日号]?',
    '\\d{1,2}\\s*[日号]',
  ].join('|'),
);

export interface ScheduleRange {
  startTime: Date;
  endTime: Date;
}

export interface ShanghaiDayRange {
  startUnix: number;
  endUnix: number;
}

export interface ShanghaiDateRange {
  start: Date;
  end: Date;
}

export interface TomorrowEarlyRange {
  start: Date;
  end: Date;
  endInclusive: Date;
}

export interface ScheduleDateExpression {
  text: string;
  index: number;
}

export interface ScheduleTimeExpression {
  text: string;
  index: number;
}

export interface ScheduleClock {
  hour: number;
  minute: number;
}

interface RelativeScheduleTime {
  amount: number;
  unit: 'month' | 'day' | 'hour';
  unitText: '个月' | '天' | '小时';
}

const TIME_EXPRESSION = new RegExp(
  [
    '(?:凌晨|早上|上午|中午|下午|傍晚|晚上)(?:\\s*[零〇一二两三四五六七八九十\\d]{1,3}(?:(?:点|时)(?:半|[零〇一二两三四五六七八九十\\d]{1,3}(?:分)?)?|[:：、][零〇一二两三四五六七八九十\\d]{1,3}(?:分)?))?',
    '[零〇一二两三四五六七八九十\\d]{1,3}(?:(?:点|时)(?:半|[零〇一二两三四五六七八九十\\d]{1,3}(?:分)?)?|[:：、][零〇一二两三四五六七八九十\\d]{1,3}(?:分)?)',
  ].join('|'),
  'g',
);

export function findScheduleDateExpression(
  text: string,
): ScheduleDateExpression | null {
  if (/(?:半\s*(?:个\s*)?小时|(?:半|[零〇一二两三四五六七八九十\d]+)\s*(?:个\s*)?(?:分钟|分|秒钟|秒))\s*后/.test(text)) {
    throw new Error('暂不支持分钟后或秒后，请使用小时后');
  }
  if (/(?:几|多少)\s*(?:个\s*)?(?:小时|钟头|月|天|日)\s*后/.test(text)) {
    throw new Error('相对时间请补充具体数字，例如“十天后”或“3小时后”');
  }
  if (/周末/.test(text)) {
    throw new Error('“周末”无法确定具体日期，请明确周六或周日');
  }
  const match = text.match(DATE_EXPRESSION);
  if (!match || match.index === undefined) {
    if (
      /(?:下下周|下下星期|下下礼拜|下周|下星期|下礼拜|本周|这周|本星期|这星期|本礼拜|这礼拜)(?![一二三四五六日天])/.test(
        text,
      )
    ) {
      throw new Error('周日期不完整，请明确周几');
    }
    return null;
  }
  parseRelativeScheduleTime(match[0]);
  return { text: match[0], index: match.index };
}

export function findScheduleTimeExpressions(
  text: string,
): ScheduleTimeExpression[] {
  return [...text.matchAll(TIME_EXPRESSION)].map((match) => ({
    text: match[0],
    index: match.index ?? 0,
  }));
}

export function resolveScheduleClock(timeText: string): ScheduleClock {
  return parseTime(timeText);
}

export function computeScheduleRange(
  dateText: string,
  timeText: string,
  endTimeTextOrDuration: string | number,
  durationOrReference: number | Date = 0,
  referenceArg: Date = new Date(),
): ScheduleRange {
  const legacyCall = typeof endTimeTextOrDuration === 'number';
  const endTimeText = legacyCall ? '' : endTimeTextOrDuration;
  const durationMinutes = legacyCall
    ? endTimeTextOrDuration
    : Number(durationOrReference);
  const reference = legacyCall
    ? durationOrReference instanceof Date
      ? durationOrReference
      : referenceArg
    : referenceArg;
  const referenceTime = dayjs(reference).tz(SHANGHAI_TIME_ZONE);
  const relative = parseRelativeScheduleTime(dateText);
  let targetDate: Dayjs;
  let start: Dayjs;
  if (relative?.unit === 'hour') {
    const normalizedTime = timeText.replace(/\s+/g, '').trim();
    if (normalizedTime && normalizedTime !== '上午') {
      throw new Error('小时后已经确定开始时刻，请不要再指定独立钟点');
    }
    if (endTimeText) {
      throw new Error('“小时后”请使用持续时长，不要再指定结束钟点');
    }
    start = referenceTime
      .add(relative.amount, 'hour')
      .second(0)
      .millisecond(0);
    targetDate = start.startOf('day');
  } else {
    targetDate = parseDate(dateText, referenceTime);
    const { hour, minute } = parseTime(timeText);
    start = targetDate.hour(hour).minute(minute).second(0).millisecond(0);
  }
  const duration = durationMinutes === 0 ? 60 : durationMinutes;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('日程时长必须大于 0 分钟');
  }

  let end: Dayjs;
  if (endTimeText) {
    const endClock = parseTime(endTimeText, extractTimePeriod(timeText));
    end = targetDate
      .hour(endClock.hour)
      .minute(endClock.minute)
      .second(0)
      .millisecond(0);
    if (!end.isAfter(start) && /凌晨|次日|第二天/.test(endTimeText)) {
      end = end.add(1, 'day');
    }
  } else {
    end = start.add(duration, 'minute');
  }

  if (!start.isValid() || !end.isValid()) {
    throw new Error('无法生成有效的日程时间');
  }
  if (!end.isAfter(start)) {
    throw new Error('日程结束时间必须晚于开始时间');
  }
  if (!start.isAfter(referenceTime)) {
    throw new Error('开始时间已经过去，请补充月份或提供新的时间');
  }

  return { startTime: start.toDate(), endTime: end.toDate() };
}

export function resolveScheduleDate(
  dateText: string,
  reference: Date = new Date(),
): Date {
  const referenceTime = dayjs(reference).tz(SHANGHAI_TIME_ZONE);
  return parseDate(dateText, referenceTime).startOf('day').toDate();
}

export function isRecognizedScheduleTime(timeText: string): boolean {
  try {
    parseTime(timeText);
    return true;
  } catch {
    return false;
  }
}

export function getShanghaiDayRangeDates(
  reference: Date = new Date(),
  dayOffset = 0,
): ShanghaiDateRange {
  const day = dayjs(reference).tz(SHANGHAI_TIME_ZONE).add(dayOffset, 'day');
  return { start: day.startOf('day').toDate(), end: day.endOf('day').toDate() };
}

export function getTomorrowEarlyRange(
  reference: Date = new Date(),
  hour = 9,
  minute = 30,
): TomorrowEarlyRange {
  const tomorrow = dayjs(reference)
    .tz(SHANGHAI_TIME_ZONE)
    .add(1, 'day');
  const endInclusive = tomorrow
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);
  return {
    start: tomorrow.startOf('day').toDate(),
    end: endInclusive.toDate(),
    endInclusive: endInclusive.toDate(),
  };
}

export function getShanghaiDayRange(
  reference: Date = new Date(),
): ShanghaiDayRange {
  const shanghaiNow = dayjs(reference).tz(SHANGHAI_TIME_ZONE);
  return {
    startUnix: shanghaiNow.startOf('day').unix(),
    endUnix: shanghaiNow.endOf('day').unix(),
  };
}

function parseDate(dateText: string, reference: Dayjs): Dayjs {
  const normalized = dateText.replace(/\s+/g, '').trim();
  if (!normalized) throw new Error('缺少日期信息');

  if (normalized.includes('大后天')) return reference.add(3, 'day').startOf('day');
  if (normalized.includes('后天')) return reference.add(2, 'day').startOf('day');
  if (normalized.includes('明天') || normalized.includes('明日')) {
    return reference.add(1, 'day').startOf('day');
  }
  if (normalized.includes('今天') || normalized.includes('今日')) {
    return reference.startOf('day');
  }

  const relative = parseRelativeScheduleTime(normalized);
  if (relative) {
    const unit = relative.unit === 'month' ? 'month' : relative.unit === 'hour' ? 'hour' : 'day';
    return reference.add(relative.amount, unit).startOf('day');
  }

  if (normalized.includes('周末')) {
    throw new Error('“周末”无法确定具体日期，请明确周六或周日');
  }

  const currentWeekday = (reference.day() + 6) % 7;
  const currentMonday = reference.startOf('day').subtract(currentWeekday, 'day');

  const thisWeek = normalized.match(
    /(?:本周|这周|本星期|这星期|本礼拜|这礼拜)([一二三四五六日天])/,
  );
  if (thisWeek) {
    const candidate = currentMonday.add(WEEKDAY_INDEX[thisWeek[1]], 'day');
    if (candidate.endOf('day').isBefore(reference)) {
      throw new Error('日期已经过去，请使用下周或提供明确日期');
    }
    return candidate;
  }

  const weekAfterNext = normalized.match(
    /(?:下下周|下下星期|下下礼拜)([一二三四五六日天])/,
  );
  if (weekAfterNext) {
    return currentMonday
      .add(14 + WEEKDAY_INDEX[weekAfterNext[1]], 'day')
      .startOf('day');
  }

  const nextWeek = normalized.match(
    /(?:下周|下星期|下礼拜)([一二三四五六日天])/,
  );
  if (nextWeek) {
    return currentMonday
      .add(7 + WEEKDAY_INDEX[nextWeek[1]], 'day')
      .startOf('day');
  }

  const bareWeekday = normalized.match(
    /(?:^|[^本这下])(?:周|星期|礼拜)([一二三四五六日天])/,
  );
  if (bareWeekday) {
    const targetWeekday = WEEKDAY_INDEX[bareWeekday[1]];
    const days = targetWeekday > currentWeekday
      ? targetWeekday
      : targetWeekday + 7;
    return currentMonday.add(days, 'day').startOf('day');
  }

  const explicit = normalized.match(
    /(?:(\d{2}|\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})[日号]?/,
  );
  if (explicit) {
    const suppliedYear = explicit[1]
      ? explicit[1].length === 2
        ? 2000 + Number(explicit[1])
        : Number(explicit[1])
      : null;
    const month = Number(explicit[2]);
    const date = Number(explicit[3]);
    const year = suppliedYear ?? reference.year();
    const candidate = reference
      .year(year)
      .date(1)
      .month(month - 1)
      .date(date)
      .startOf('day');

    if (
      candidate.month() !== month - 1 ||
      candidate.date() !== date ||
      candidate.year() !== year
    ) {
      throw new Error('日期无效，请检查月份和日期');
    }
    if (!suppliedYear && candidate.endOf('day').isBefore(reference)) {
      throw new Error('日期已经过去，请补充年份');
    }
    return candidate;
  }

  const dayOnly = normalized.match(/(?:^|\D)(\d{1,2})[日号](?:\D|$)/);
  if (dayOnly) {
    const date = Number(dayOnly[1]);
    const candidate = reference.date(1).date(date).startOf('day');
    if (candidate.date() !== date) throw new Error('日期无效，请检查日期');
    if (candidate.endOf('day').isBefore(reference)) {
      throw new Error('日期已经过去，请补充月份');
    }
    return candidate;
  }

  throw new Error(`无法识别日期：${dateText}`);
}

function parseTime(
  timeText: string,
  inheritedPeriod = '',
): { hour: number; minute: number } {
  const normalized = timeText.replace(/\s+/g, '').trim();
  if (!normalized) throw new Error('缺少时间信息');

  if (normalized === '上午' || normalized === '早上') return { hour: 10, minute: 0 };
  if (normalized === '下午') return { hour: 14, minute: 0 };
  if (normalized === '晚上') return { hour: 19, minute: 0 };

  const explicitPeriod = extractTimePeriod(normalized);
  const period = explicitPeriod || inheritedPeriod;

  const twentyFourHour = normalized.match(
    /(?:^|\D)(\d{1,2})[:：、](\d{1,2})(?:分)?(?:\D|$)/,
  );
  if (twentyFourHour) {
    let hour = Number(twentyFourHour[1]);
    validatePeriod(period, hour);
    hour = applyPeriod(period, hour);
    return validateTime(hour, Number(twentyFourHour[2]));
  }

  const chineseTime = normalized.match(
    /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零〇一二两三四五六七八九十\d]{1,3})[点时](半|[零〇一二两三四五六七八九十\d]{1,3})?(?:分)?/,
  );
  if (!chineseTime) throw new Error(`无法识别时间：${timeText}`);

  const chinesePeriod = chineseTime[1] || inheritedPeriod;
  let hour = parseChineseNumber(chineseTime[2]);
  const minute = chineseTime[3]
    ? chineseTime[3] === '半'
      ? 30
      : parseChineseNumber(chineseTime[3])
    : 0;

  validatePeriod(chinesePeriod, hour);
  hour = applyPeriod(chinesePeriod, hour);

  return validateTime(hour, minute);
}

function extractTimePeriod(timeText: string): string {
  return timeText.match(/凌晨|早上|上午|中午|下午|傍晚|晚上/)?.[0] ?? '';
}

function applyPeriod(period: string, hour: number): number {
  if (period === '凌晨' && hour === 12) return 0;
  if (period === '中午' && hour >= 1 && hour <= 5) return hour + 12;
  if (['下午', '傍晚', '晚上'].includes(period) && hour < 12) {
    return hour + 12;
  }
  return hour;
}

function validatePeriod(period: string, hour: number): void {
  if (['凌晨', '早上', '上午'].includes(period) && hour > 12) {
    throw new Error(`时间表达矛盾：${period}${hour}点`);
  }
  if (['下午', '傍晚', '晚上'].includes(period) && hour >= 12 && hour < 18) {
    if (period === '晚上') throw new Error(`时间表达矛盾：${period}${hour}点`);
  }
}

function parseChineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (CHINESE_DIGITS[value[1]] ?? 0);
  if (value.endsWith('十')) return (CHINESE_DIGITS[value[0]] ?? 0) * 10;
  if (value.includes('十')) {
    return (
      (CHINESE_DIGITS[value[0]] ?? 0) * 10 +
      (CHINESE_DIGITS[value[value.length - 1]] ?? 0)
    );
  }
  if (value.length === 1 && value in CHINESE_DIGITS) {
    return CHINESE_DIGITS[value];
  }
  throw new Error(`无法识别中文数字：${value}`);
}

function parseRelativeScheduleTime(
  value: string,
): RelativeScheduleTime | null {
  const normalized = value.replace(/\s+/g, '').trim();
  const match = normalized.match(
    new RegExp(`(${RELATIVE_AMOUNT_PATTERN})(?:个)?(小时|钟头|月|天|日)后`),
  );
  if (!match) return null;
  const amount = parseChineseNumber(match[1]);
  const rawUnit = match[2];
  const unit: RelativeScheduleTime['unit'] =
    rawUnit === '月'
      ? 'month'
      : rawUnit === '小时' || rawUnit === '钟头'
        ? 'hour'
        : 'day';
  const unitText: RelativeScheduleTime['unitText'] =
    unit === 'month' ? '个月' : unit === 'hour' ? '小时' : '天';
  const maximum = unit === 'month' ? 120 : unit === 'day' ? 3650 : 87600;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('相对时间数量必须大于 0');
  }
  if (amount > maximum) {
    throw new Error(`相对时间不能超过 ${maximum} ${unitText}`);
  }
  return { amount, unit, unitText };
}

function validateTime(hour: number, minute: number) {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('时间无效，请使用 0:00 至 23:59 之间的时间');
  }
  return { hour, minute };
}
