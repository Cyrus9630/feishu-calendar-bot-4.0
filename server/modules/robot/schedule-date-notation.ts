// One date-token grammar for source text, AI output, queries and corrections.
const DIGITS = '零〇一二两三四五六七八九十';
const DAY = `[${DIGITS}0-9０-９]{1,3}`;
const YEAR = `[${DIGITS}0-9０-９]{2,4}`;
const DATE_PATTERN = new RegExp(
  `(?<![0-9０-９A-Za-z./．-])(?:(${YEAR})\\s*[年./．-]\\s*)?(${DAY})\\s*([月./．-])\\s*(${DAY})\\s*([日号])?(?![0-9０-９./．-])`,
  'g',
);

export function normalizeDateDigits(value: string): string {
  return value.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
}

function dateNumber(value: string): number {
  const normalized = normalizeDateDigits(value);
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const digits: Record<string, number> = {
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
  if (normalized.includes('十')) {
    if (!/^[一二两三四五六七八九]?十[一二三四五六七八九]?$/.test(normalized))
      throw new Error('日期中的中文数字无效，请检查月份和日期');
    const [tens, ones] = normalized.split('十');
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return Number([...normalized].map((digit) => digits[digit]).join(''));
}

function dateMatches(text: string) {
  return [...text.matchAll(DATE_PATTERN)].filter((match) => {
    // A dot in an amount, duration, version or file name is not a date.
    if (match[3] === '月') return true;
    const prefix = text.slice(0, match.index).trimEnd();
    const suffix = text.slice((match.index ?? 0) + match[0].length);
    return (
      !/(?:版本|编号|金额|费用|价格|利率|利息|赔偿|借款|支付|付|v)\s*[:：]?$/i.test(
        prefix,
      ) && !/^\s*(?:万|亿|元|块|%|％|小时|分钟|秒|个月|天后|日后)/.test(suffix)
    );
  });
}

export function findExplicitScheduleDate(text: string) {
  const match = dateMatches(text)[0];
  return match ? { text: match[0].trimEnd(), index: match.index ?? 0 } : null;
}

export function normalizeScheduleDateNotation(text: string): string {
  let result = text;
  // Replace backwards to preserve offsets of all remaining source tokens.
  for (const match of dateMatches(text).reverse()) {
    const year = match[1] ? `${dateNumber(match[1])}年` : '';
    const date = `${year}${dateNumber(match[2])}月${dateNumber(match[4])}${match[5] || '日'}`;
    const trailingSpace = match[0].match(/\s+$/)?.[0] || '';
    const index = match.index ?? 0;
    result =
      result.slice(0, index) +
      date +
      trailingSpace +
      result.slice(index + match[0].length);
  }
  return result;
}
