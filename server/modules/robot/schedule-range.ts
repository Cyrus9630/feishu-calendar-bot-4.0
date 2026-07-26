import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { resolveScheduleClock, resolveScheduleDate } from './schedule-time';

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = 'Asia/Shanghai';
const DATE = '(?:(?:\\d{2}|\\d{4})年)?(?:\\d{1,2}月)?\\d{1,2}[日号]';
const TIME =
  '(?:(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\\s*[零〇一二两三四五六七八九十\\d]{1,3}(?:点|时|[:：、])(?:半|[零〇一二两三四五六七八九十\\d]{1,3})?(?:分)?)';
const RANGE = new RegExp(
  `(${DATE})\\s*(${TIME})?\\s*(?:至|到|—|-|~|～)\\s*(${DATE})\\s*(${TIME})?`,
);

export interface CrossDayScheduleRange {
  startTime: Date;
  endTime: Date;
  allDay: boolean;
}

function inheritDateParts(startText: string, endText: string) {
  const startYear = startText.match(/(\d{2}|\d{4})年/)?.[1];
  const startMonth = startText.match(/(\d{1,2})月/)?.[1];
  let value = endText;
  if (!/\d{1,2}月/.test(value) && startMonth) value = `${startMonth}月${value}`;
  if (!/(?:\d{2}|\d{4})年/.test(value) && startYear)
    value = `${startYear}年${value}`;
  return value;
}

export function parseCrossDayScheduleRange(
  text: string,
  reference = new Date(),
): CrossDayScheduleRange | null {
  const match = text.match(RANGE);
  if (!match) return null;
  const [
    ,
    startDateText,
    startTimeText = '',
    rawEndDateText,
    endTimeText = '',
  ] = match;
  if (!!startTimeText !== !!endTimeText) {
    throw new Error('跨日日程请同时写明开始和结束时间');
  }
  const startDate = resolveScheduleDate(startDateText, reference);
  const endDateText = inheritDateParts(startDateText, rawEndDateText);
  let endDate: Date;
  try {
    endDate = resolveScheduleDate(endDateText, startDate);
  } catch (error) {
    if (!/(?:\d{2}|\d{4})年/.test(endDateText)) {
      const nextYear = dayjs(startDate).tz(ZONE).add(1, 'year').toDate();
      endDate = resolveScheduleDate(endDateText, nextYear);
    } else {
      throw error;
    }
  }
  if (!startTimeText) {
    const start = dayjs(startDate).tz(ZONE).startOf('day');
    const endExclusive = dayjs(endDate).tz(ZONE).startOf('day').add(1, 'day');
    if (!endExclusive.isAfter(start))
      throw new Error('跨日日程结束日期必须不早于开始日期');
    if (!endExclusive.isAfter(dayjs(reference)))
      throw new Error('跨日日程已经结束，请提供未来日期');
    return {
      startTime: start.toDate(),
      endTime: endExclusive.toDate(),
      allDay: true,
    };
  }
  const startClock = resolveScheduleClock(startTimeText);
  const endClock = resolveScheduleClock(endTimeText);
  const start = dayjs(startDate)
    .tz(ZONE)
    .hour(startClock.hour)
    .minute(startClock.minute)
    .second(0)
    .millisecond(0);
  const end = dayjs(endDate)
    .tz(ZONE)
    .hour(endClock.hour)
    .minute(endClock.minute)
    .second(0)
    .millisecond(0);
  if (!end.isAfter(start)) throw new Error('跨日日程结束时间必须晚于开始时间');
  if (!start.isAfter(dayjs(reference)))
    throw new Error('开始时间已经过去，请提供新的时间');
  return { startTime: start.toDate(), endTime: end.toDate(), allDay: false };
}
