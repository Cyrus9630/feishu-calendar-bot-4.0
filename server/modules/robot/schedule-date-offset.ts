import { normalizeDateDigits } from './schedule-date-notation';

interface DateToken {
  text: string;
  index: number;
}

const NUMBER = '[0-9０-９零〇一二两三四五六七八九十]+';
const DIRECTION = '(?:之前|以前|前面|往前|提前|前|之后|以后|后面|往后|后)';
const PREFIX_OFFSET = new RegExp(
  `^\\s*(?:的\\s*)?(${DIRECTION})\\s*(${NUMBER})\\s*[天日]`,
);
const SUFFIX_OFFSET = new RegExp(
  `^\\s*(?:的\\s*)?(${NUMBER})\\s*[天日]\\s*(${DIRECTION})`,
);

function dayCount(raw: string): number {
  const value = normalizeDateDigits(raw);
  const digits = '零一二三四五六七八九';
  const canonical = value.replace(/〇/g, '零').replace(/两/g, '二');
  let amount: number;
  if (/^\d+$/.test(value)) amount = Number(value);
  else if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(canonical)) {
    const [tens, ones] = canonical.split('十');
    amount =
      (tens ? digits.indexOf(tens) : 1) * 10 +
      (ones ? digits.indexOf(ones) : 0);
  } else if (/^[零一二三四五六七八九]+$/.test(canonical)) {
    amount = Number(
      [...canonical].map((digit) => digits.indexOf(digit)).join(''),
    );
  } else throw new Error('日期前后天数无效，请提供明确的整数天数');
  if (!Number.isInteger(amount) || amount < 0 || amount > 3650)
    throw new Error('日期前后天数须为 0 至 3650 的整数');
  return amount;
}

/** Only consume an offset adjacent to a recognized date, never a later reminder. */
export function extendScheduleDateOffset(text: string, date: DateToken) {
  const tail = text.slice(date.index + date.text.length);
  const prefix = tail.match(PREFIX_OFFSET);
  const suffix = prefix ? null : tail.match(SUFFIX_OFFSET);
  const match = prefix || suffix;
  if (!match) {
    if (
      /^\s*(?:的\s*)?(?:之前|以前|前面|往前|提前|前|之后|以后|后面|往后|后)\s*[-+−半几多少\d０-９零〇一二两三四五六七八九十]/.test(
        tail,
      ) ||
      /^\s*(?:的\s*)?[-+−半几多少\d０-９零〇一二两三四五六七八九十.．]+\s*[天日]\s*(?:前|后|之前|之后|以前|以后)/.test(
        tail,
      )
    )
      throw new Error('日期前后请使用明确的整数天数，例如“11月11日前16天”');
    return date;
  }
  const remaining = tail.slice(match[0].length);
  // A second offset or a range must not silently become one date.
  if (
    /^\s*(?:[前后](?=$|[\s，,。；;])|(?:的)?(?:之前|之后|以前|以后|前面|后面|往前|往后|前|后)\s*[\d零〇一二两三四五六七八九十]+\s*[天日]|(?:到|至|[-—~～])\s*(?:前|后|\d))/.test(
      remaining,
    )
  )
    throw new Error('日期存在多重偏移或范围，请提供一个确定的日期');
  const direction = prefix ? match[1] : match[2];
  const amount = dayCount(prefix ? match[2] : match[1]);
  return {
    text: date.text + match[0],
    index: date.index,
    anchor: date.text,
    dayOffset: /前/.test(direction) ? -amount : amount,
  };
}
