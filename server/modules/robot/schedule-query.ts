import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { EVENT_COLORS, type EventColorName } from './schedule-command';
import {
  findScheduleDateExpression,
  resolveScheduleDate,
} from './schedule-time';

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = 'Asia/Shanghai';

export interface ScheduleQuery {
  start: Date;
  end: Date;
  label: string;
  colorName?: EventColorName;
  color?: number;
}

const COLOR_PATTERN =
  /(红色|橙色|黄色|绿色|蓝色|紫色|灰色|红|橙|黄|绿|蓝|紫|灰)/;
const COLOR_ALIASES: Record<string, EventColorName> = {
  红: '红色',
  红色: '红色',
  橙: '橙色',
  橙色: '橙色',
  黄: '黄色',
  黄色: '黄色',
  绿: '绿色',
  绿色: '绿色',
  蓝: '蓝色',
  蓝色: '蓝色',
  紫: '紫色',
  紫色: '紫色',
  灰: '灰色',
  灰色: '灰色',
};

function shanghaiStartOfDay(reference: Date) {
  return dayjs(reference).tz(ZONE).startOf('day');
}

function mondayOfWeek(reference: Date) {
  const local = shanghaiStartOfDay(reference);
  const weekday = local.day() === 0 ? 7 : local.day();
  return local.subtract(weekday - 1, 'day');
}

function hasQueryLanguage(text: string) {
  const short = text
    .replace(/\s+/g, '')
    .match(/^(?:我的?|)(.+?)(?:的)?(?:安排|日程|事项)[？?]?$/);
  if (short) {
    const dateText = short[1].replace(/的$/, '');
    const date = /(?:周|星期|礼拜)(?![一二三四五六日天1-7])/.test(dateText)
      ? null
      : findScheduleDateExpression(dateText);
    if (date?.index === 0 && date.text.length === dateText.length) return true;
  }
  return /(?:什么|哪些|哪几|有几|有没有|查询|查看|看看|列出).*(?:安排|日程|事项)|(?:安排|日程|事项).*(?:什么|哪些|哪几|有几|有没有|查询|查看|看看)|^(?:今天|明天|后天|本周|这周|下周|本月|这个月|下个月)(?:的)?(?:安排|日程|事项)?[？?]?$/i.test(
    text.trim(),
  );
}

export function parseScheduleQuery(
  text: string,
  reference = new Date(),
): ScheduleQuery | null {
  const value = text.trim().replace(/[？?。！!]+$/, '');
  if (
    /(?:修改|删除|取消|新增|创建|添加|改到|改为|改成|推迟|提前|撤销|暂停|恢复)/.test(
      value,
    )
  )
    return null;
  if (!hasQueryLanguage(value)) return null;

  const colorToken = value.match(COLOR_PATTERN)?.[1];
  const colorName = colorToken ? COLOR_ALIASES[colorToken] : undefined;
  const color = colorName ? EVENT_COLORS[colorName] : undefined;
  const today = shanghaiStartOfDay(reference);
  let start;
  let end;
  let label: string;

  const weekRange =
    /(?:下下周|下下星期|下下礼拜|下周|下星期|下礼拜|本周|这周)(?![一二三四五六日天1-7])/.test(
      value,
    );
  const date = weekRange ? null : findScheduleDateExpression(value);
  if (date) {
    start = dayjs(resolveScheduleDate(date.text, reference, true)).tz(ZONE);
    end = start.add(1, 'day');
    label =
      (
        {
          今天: '今日日程',
          今日: '今日日程',
          明天: '明日日程',
          明日: '明日日程',
          后天: '后日日程',
        } as Record<string, string>
      )[date.text] || `${start.format('YYYY-MM-DD')}日程`;
  } else if (/下周/.test(value)) {
    start = mondayOfWeek(reference).add(1, 'week');
    end = start.add(1, 'week');
    label = '下周日程';
  } else if (/(本周|这周)/.test(value)) {
    start = mondayOfWeek(reference);
    end = start.add(1, 'week');
    label = '本周日程';
  } else if (/下个月/.test(value)) {
    start = today.add(1, 'month').startOf('month');
    end = start.add(1, 'month');
    label = '下月日程';
  } else if (/(本月|这个月)/.test(value)) {
    start = today.startOf('month');
    end = start.add(1, 'month');
    label = '本月日程';
  } else if (/后天/.test(value)) {
    start = today.add(2, 'day');
    end = start.add(1, 'day');
    label = '后日日程';
  } else if (/明天/.test(value)) {
    start = today.add(1, 'day');
    end = start.add(1, 'day');
    label = '明日日程';
  } else if (/(今天|今日)/.test(value)) {
    start = today;
    end = start.add(1, 'day');
    label = '今日日程';
  } else if (colorName) {
    start = dayjs(reference);
    end = start.add(1, 'year');
    label = `未来一年${colorName}日程`;
  } else {
    return null;
  }

  return {
    start: start.toDate(),
    end: end.toDate(),
    label,
    colorName,
    color,
  };
}
