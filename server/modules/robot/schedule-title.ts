import { normalizeColor } from './schedule-command';
import {
  findScheduleDateExpression,
  findScheduleTimeExpressions,
} from './schedule-time';

const NUMBER = '[零〇一二两三四五六七八九十0-9０-９]+';
const COLORS =
  /(?:颜色\s*(?:修改|改|调整)?\s*(?:为|成|是)?\s*[:：]?\s*)?(?:标[红橙黄绿蓝紫灰]|[红橙黄绿蓝紫灰]标|[红橙黄绿蓝紫灰]色)(?=$|[\s，,。；;！!])/g;
const SHORT_COLORS = /(^|[\s，,；;])([红橙黄绿蓝紫灰])(?=$|[\s，,。；;！!])/g;

/** Remove only evidenced settings; spaces never terminate a matter title. */
export function extractScheduleMatterText(
  source: string,
  location = '',
): string {
  let value = source
    .replace(COLORS, ' ')
    .replace(SHORT_COLORS, '$1 ')
    .replace(
      new RegExp(
        `(?:提前|开始前)\\s*${NUMBER}\\s*(?:分钟|分|个?小时|天)(?:\\s*(?:提醒(?:我)?|通知(?:我)?))?`,
        'g',
      ),
      ' ',
    )
    .replace(/不(?:用|需要)?提醒|不提醒/g, ' ')
    .replace(
      new RegExp(
        `(?:持续|时长)?\\s*(?:${NUMBER}\\s*(?:个)?半小时|半个?小时|${NUMBER}\\s*(?:个)?小时|${NUMBER}\\s*分钟)(?!后)`,
        'g',
      ),
      ' ',
    )
    .replace(/每\s*年|每\s*(?:[零〇一二两三四五六七八九十\d]+\s*个?)?月/g, ' ');

  // A model's location guess alone is not evidence that a person's name is a place.
  if (location.trim()) {
    const literal = location.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(
      new RegExp(
        `(?:地点|位置|地址)\\s*(?:改为|为|是|在)?\\s*[:：]?\\s*${literal}|(?:在|去)\\s*${literal}`,
        'g',
      ),
      ' ',
    );
  }
  value = value.replace(
    /(?:地点|位置|地址)(?:\s*[:：]\s*|\s+|(?:改为|为|是|在)\s*)[^\s，,；;。]+/g,
    ' ',
  );
  // Keep range connectors out of titles, while retaining ordinary text between dates.
  for (let i = 0; i < 8; i += 1) {
    const date = findScheduleDateExpression(value);
    if (!date) break;
    value =
      value.slice(0, date.index) +
      ' ' +
      value.slice(date.index + date.text.length);
  }
  for (const time of findScheduleTimeExpressions(value).reverse()) {
    value =
      value.slice(0, time.index) +
      ' ' +
      value.slice(time.index + time.text.length);
  }
  return value
    .replace(
      /^(?:请|麻烦)?\s*(?:帮我|给我)?\s*(?:创建|新增|添加|安排|记一下|记下)\s*[:：]?\s*/,
      '',
    )
    .replace(/^[\s，,、:：。！!；;—~～-]+|[\s，,、:：。！!；;—~～-]+$/g, '')
    .replace(/^(?:至|到)\s+|\s+(?:至|到)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sourceScheduleColor(source: string) {
  const matches = [...source.matchAll(COLORS)].map((match) => match[0]);
  for (const match of source.matchAll(SHORT_COLORS)) matches.push(match[2]);
  if (!matches.length) return undefined;
  return normalizeColor(
    matches
      .join(' ')
      .replace(/颜色\s*(?:修改|改|调整)?\s*(?:为|成|是)?\s*[:：]?\s*/g, ''),
  );
}

/** Enrich a model title only when the source demonstrably contains that title. */
export function preserveScheduleTitle(
  source: string,
  title: string,
  location = '',
) {
  const matter = extractScheduleMatterText(source, location);
  const compact = (value: string) => value.replace(/[\s，,、。；;:：]/g, '');
  const original = compact(title);
  if (!matter) return title.trim();
  if (!original || compact(matter).includes(original)) return matter;
  return title.trim();
}

export function withScheduleSource(
  description: string | undefined,
  source: string,
  update = false,
) {
  const label = update ? '修改指令：' : '指令内容：';
  const lines = (description || '')
    .split('\n')
    .filter((line) => line && !line.startsWith(label));
  lines.push(label + source.replace(/\s+/g, ' ').trim());
  return lines.join('\n');
}
