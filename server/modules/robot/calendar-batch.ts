export type BatchCalendarAction = 'create' | 'cancel';

export interface BatchEnvelope {
  isBatch: boolean;
  action: BatchCalendarAction;
  items: string[];
}

const MAX_BATCH_ITEMS = 20;
const CREATE_PREFIX = /^(?:批量\s*)?(?:创建|添加|新增)(?:日程)?\s*[:：]?\s*/;
const CANCEL_PREFIX = /^(?:批量\s*)?(?:删除|取消)(?:日程)?\s*[:：]?\s*/;
const NUMBER_PREFIX = /^\s*\d+\s*[.、)）]\s*/;
const DATE_EXPRESSION =
  /(?:今天|今日|明天|明日|后天|大后天|(?:下下周|下下星期|下下礼拜|下周|下星期|下礼拜|本周|这周|本星期|这星期|本礼拜|这礼拜|周|星期|礼拜)[一二三四五六日天]|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[日号])/;
const TIME_EXPRESSION =
  /(?:凌晨|早上|上午|中午|下午|傍晚|晚上|\d{1,2}\s*[点时]|\d{1,2}\s*[:：]\s*\d{1,2})/;

function explicitAction(value: string): BatchCalendarAction | null {
  if (CANCEL_PREFIX.test(value.trim())) return 'cancel';
  if (CREATE_PREFIX.test(value.trim())) return 'create';
  return null;
}

function stripAction(value: string): string {
  return value
    .trim()
    .replace(CREATE_PREFIX, '')
    .replace(CANCEL_PREFIX, '')
    .trim();
}

function stripNumber(value: string): string {
  return value.replace(NUMBER_PREFIX, '').trim();
}

function splitStrong(value: string): string[] {
  const normalized = value
    .replace(/\s+(?=\d+\s*[.、)）]\s*)/g, '\n')
    .replace(/[；;]/g, '\n');
  return normalized
    .split(/\r?\n+/)
    .map(stripNumber)
    .filter(Boolean);
}

function splitLoose(value: string): string[] {
  const items = value
    .split(/[，,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length < 2 || !DATE_EXPRESSION.test(items[0]))
    return [value.trim()];
  if (
    items
      .slice(1)
      .every((item) => DATE_EXPRESSION.test(item) || TIME_EXPRESSION.test(item))
  ) {
    return items;
  }
  return [value.trim()];
}

function inheritBatchDates(items: string[]): string[] {
  let inheritedDate = '';
  return items.map((item) => {
    const explicitDate = item.match(DATE_EXPRESSION)?.[0] || '';
    if (explicitDate) {
      inheritedDate = explicitDate;
      return item;
    }
    return inheritedDate ? `${inheritedDate}${item}` : item;
  });
}

export function parseBatchEnvelope(text: string): BatchEnvelope {
  const original = text.trim();
  if (!original) throw new Error('批量指令不能为空');
  const declaredBatch = /^批量\s*/.test(original);
  const leadingAction = explicitAction(original) || 'create';
  const withoutLeadingAction = stripAction(original);
  let items = splitStrong(withoutLeadingAction);
  if (items.length === 1) items = splitLoose(items[0]);

  const itemActions = items
    .map(explicitAction)
    .filter((action): action is BatchCalendarAction => action !== null);
  const actions = new Set<BatchCalendarAction>([leadingAction, ...itemActions]);
  if (actions.size > 1) {
    throw new Error('同一批次不能混合创建和删除，请分开发送');
  }
  items = items.map(stripAction).filter(Boolean);
  if (items.length === 0) throw new Error('没有识别到批量事项');
  if (items.length > MAX_BATCH_ITEMS) {
    throw new Error(`单次最多处理${MAX_BATCH_ITEMS}项，请拆分发送`);
  }
  return {
    isBatch: declaredBatch || items.length > 1,
    action: leadingAction,
    items: items.length > 1 ? inheritBatchDates(items) : items,
  };
}

function selectionTokens(
  text: string,
  allowNumberSuffix: boolean,
): string[] | null {
  const suffix = allowNumberSuffix ? /\s*(?:项|号)\s*$/ : /\s*项\s*$/;
  const value = text
    .trim()
    .replace(/^第\s*/, '')
    .replace(suffix, '')
    .replace(/\s*([-—~至])\s*/g, '$1');
  if (!value || !/^[\d、,，\s\-—~至]+$/.test(value)) return null;
  const tokens = value.split(/[、,，\s]+/).filter(Boolean);
  return tokens.length > 0 &&
    tokens.every((token) => /^\d+(?:[-—~至]\d+)?$/.test(token))
    ? tokens
    : null;
}

export function isSelectionText(text: string): boolean {
  return selectionTokens(text, false) !== null;
}

export function parseSelectionIndexes(
  text: string,
  candidateCount: number,
): number[] {
  const tokens = selectionTokens(text, true);
  if (!tokens) {
    throw new Error('序号格式无法识别，请回复如“@日程机器人 1、3、5-7”');
  }
  const indexes: number[] = [];
  for (const token of tokens) {
    const bounds = token.split(/[-—~至]/).map((item) => Number(item.trim()));
    const start = bounds[0];
    const end = bounds[1] ?? start;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end > candidateCount
    ) {
      throw new Error(
        `序号必须在1-${candidateCount}之间，区间起点不能大于终点`,
      );
    }
    for (let index = start; index <= end; index += 1) {
      if (!indexes.includes(index)) indexes.push(index);
    }
  }
  return indexes;
}
