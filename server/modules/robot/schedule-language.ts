export interface SpokenScheduleNormalization {
  text: string;
  durationMinutes?: number;
}

export interface SpokenScheduleOptions {
  extractDuration?: boolean;
}

const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  俩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const NUMBER = '[零〇一二两俩三四五六七八九十\\d]+';

function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '俩') return 2;
  if (!value.includes('十') && value.length > 1) {
    const digits = [...value].map((item) => DIGITS[item]);
    if (digits.every((item) => item !== undefined)) {
      return Number(digits.join(''));
    }
  }
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (DIGITS[value[1]] ?? 0);
  if (value.endsWith('十')) return (DIGITS[value[0]] ?? 0) * 10;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (DIGITS[tens] ?? 0) * 10 + (DIGITS[ones] ?? 0);
  }
  if (value in DIGITS) return DIGITS[value];
  throw new Error(`无法识别数字：${value}`);
}

function assertUnambiguous(value: string) {
  const hasExactDate =
    /(?:今天|今日|明天|明日|后天|大后天|(?:周|星期|礼拜)[一二三四五六日天1-7]|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[日号]|[零〇一二两三四五六七八九十]{1,3}月[零〇一二两三四五六七八九十]{1,3}[日号])/.test(
      value,
    );
  if (/周末/.test(value) && !hasExactDate) {
    throw new Error('“周末”不确定是周六还是周日，请明确日期');
  }
  if (/(?:月初|月中|月底)/.test(value) && !hasExactDate) {
    throw new Error('“月初、月中、月底”不是确定日期，请明确到几号');
  }
  if (/(?:两三|三四|四五|五六|六七|七八|八九)点/.test(value)) {
    throw new Error('检测到多个可能钟点，请明确一个具体钟点');
  }
  if (/(?:几点|晚点|有空时|有空的时候)/.test(value)) {
    throw new Error('时间不确定，请提供具体时间');
  }
  if (/(?:过|再过)\s*几\s*(?:天|日|个月|小时|钟头)/.test(value)) {
    throw new Error('相对时间请补充具体数字');
  }
  if (/(?:大概|差不多|左右)/.test(value)) {
    throw new Error('检测到近似时间，请提供确定时间');
  }
  if (/^(?:这个|那个)(?:日程|安排|事项)?不要了$/.test(value.trim())) {
    throw new Error('目标日程不明确，请说“刚才那个”或提供日期和事项');
  }
}

function normalizeShorthand(value: string) {
  return value
    .replace(/今早/g, '今天上午')
    .replace(/明早/g, '明天上午')
    .replace(/今(?:天)?晚(?!上)/g, '今天晚上')
    .replace(/明(?:天)?晚(?!上)/g, '明天晚上')
    .replace(/下个(?:星期|礼拜)/g, '下星期')
    .replace(/这个(?:星期|礼拜)/g, '本星期')
    .replace(
      /(周|星期|礼拜)([1-7])/g,
      (_match, prefix: string, day: string) => {
        const names = ['一', '二', '三', '四', '五', '六', '日'];
        return `${prefix}${names[Number(day) - 1]}`;
      },
    );
}

function normalizeRelative(value: string) {
  let result = value.replace(
    new RegExp(
      `(?<!超)(?:再)?过\\s*(${NUMBER})\\s*(个)?(月|天|日|小时|钟头)`,
      'g',
    ),
    (_match, amount: string, classifier: string, unit: string) =>
      `${chineseNumber(amount)}${classifier || ''}${unit}后`,
  );
  result = result.replace(
    new RegExp(`(${NUMBER})\\s*(?:个)?周后`, 'g'),
    (_match, amount: string) => `${chineseNumber(amount) * 7}天后`,
  );
  return result;
}

function normalizeDateNumbers(value: string) {
  return value
    .replace(
      /([零〇一二两三四五六七八九十]{2,4})年/g,
      (_match, number: string) => `${chineseNumber(number)}年`,
    )
    .replace(
      /([零〇一二两三四五六七八九十]{1,3})月/g,
      (_match, number: string) => `${chineseNumber(number)}月`,
    )
    .replace(
      /([零〇一二两三四五六七八九十]{1,3})(日|号)(?!线|楼|门)/g,
      (_match, number: string, suffix: string) =>
        `${chineseNumber(number)}${suffix}`,
    );
}

function normalizeClockNumbers(value: string) {
  return value
    .replace(
      new RegExp(`(${NUMBER})(点|时)一刻`, 'g'),
      (_match, hour: string, suffix: string) =>
        `${chineseNumber(hour)}${suffix}15分`,
    )
    .replace(
      new RegExp(
        `(${NUMBER})(点|时)([零〇一二两三四五六七八九十]{1,3})(?:分)?`,
        'g',
      ),
      (_match, hour: string, suffix: string, minute: string) =>
        `${chineseNumber(hour)}${suffix}${chineseNumber(minute)}分`,
    )
    .replace(
      new RegExp(`(${NUMBER})(点|时)`, 'g'),
      (_match, hour: string, suffix: string) =>
        `${chineseNumber(hour)}${suffix}`,
    );
}

function extractDuration(value: string) {
  const patterns: Array<{
    regex: RegExp;
    minutes: (match: RegExpMatchArray) => number;
  }> = [
    {
      regex: new RegExp(`(${NUMBER})(?:个)?半小时(?!后)`),
      minutes: (match) => chineseNumber(match[1]) * 60 + 30,
    },
    { regex: /半(?:个)?小时(?!后)/, minutes: () => 30 },
    {
      regex: new RegExp(`(${NUMBER})(?:个)?小时(?!后)`),
      minutes: (match) => chineseNumber(match[1]) * 60,
    },
    {
      regex: new RegExp(`(${NUMBER})分钟(?!后)`),
      minutes: (match) => chineseNumber(match[1]),
    },
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern.regex);
    if (!match) continue;
    const durationMinutes = pattern.minutes(match);
    if (durationMinutes <= 0 || durationMinutes > 7 * 24 * 60) {
      throw new Error('日程时长必须大于0且不超过7天');
    }
    return {
      text: value
        .replace(pattern.regex, '')
        .replace(/(?:持续|时长)\s*$/, '')
        .trim(),
      durationMinutes,
    };
  }
  return { text: value };
}

function normalizeCancellation(value: string) {
  let result = value.replace(/不要忘了?/g, '');
  if (/^(?:取消|删除)/.test(result)) return result;
  if (/刚才(?:那个)?不要了$/.test(result)) return '取消刚才';
  const trailing = result.match(/^(.+?)(?:取消掉?|不要了)$/);
  if (trailing) return `取消${trailing[1]}`;
  const noNeed = result.match(/^(.+?)(?:不用|不需要)(.+?)(?:了)?$/);
  if (noNeed) return `取消${noNeed[1]}${noNeed[2]}`;
  const negatedVerb = result.match(
    /^(.+?)不(去|开|做|参加|办|处理)(.+?)(?:了)$/,
  );
  if (negatedVerb) {
    return `取消${negatedVerb[1]}${negatedVerb[2]}${negatedVerb[3]}`;
  }
  return result;
}

function stripFillers(value: string) {
  return value
    .replace(
      /^(?:麻烦|请)?\s*(?:你)?\s*(?:帮我|给我)?\s*(?:记一下|记下|添加一下|添加|安排一下|安排|提醒我)\s*[,，]?\s*/,
      '',
    )
    .replace(/^我(?:想|要)(?:在)?\s*/, '')
    .replace(/[吧呀啊]\s*$/, '')
    .trim();
}

export function normalizeSpokenSchedule(
  source: string,
  options: SpokenScheduleOptions = {},
): SpokenScheduleNormalization {
  let text = source.trim().replace(/[。！!]+$/, '');
  if (!text) throw new Error('日程指令不能为空');
  assertUnambiguous(text);
  text = normalizeCancellation(text);
  text = normalizeShorthand(text);
  text = normalizeRelative(text);
  text = normalizeDateNumbers(text);
  text = normalizeClockNumbers(text);
  const duration =
    options.extractDuration === false ? { text } : extractDuration(text);
  text = stripFillers(duration.text).replace(
    /^[,，、:：\s]+|[,，、:：\s]+$/g,
    '',
  );
  return duration.durationMinutes
    ? { text, durationMinutes: duration.durationMinutes }
    : { text };
}
