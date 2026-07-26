import type {
  CalendarOperation,
  CardActionDecision,
  CardActionValue,
} from './calendar-action.types';

type CardTemplate = 'blue' | 'red' | 'orange' | 'green' | 'grey';

export interface CalendarCardDetail {
  label: string;
  value: string;
}

export interface PendingCalendarCardInput {
  actionId: string;
  operation: CalendarOperation;
  summary: string;
  timeText: string;
  colorName: string;
  location?: string;
  red: boolean;
  conflicts: string[];
  expiresAt: string;
  restorable?: boolean;
  details?: CalendarCardDetail[];
  recurrenceText?: string;
}

export interface SuccessCalendarCardInput {
  title: string;
  summary: string;
  timeText: string;
  colorName?: string;
  location?: string;
  undoActionId?: string;
  undoExpiresAt?: string;
  recurrenceText?: string;
}

export interface TerminalCardInput {
  title: string;
  message: string;
  status: 'success' | 'cancelled' | 'expired' | 'failed';
}

function actionValue(
  actionId: string,
  decision: CardActionDecision,
): CardActionValue {
  return { actionId, decision };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\*~><\[\]()#:_]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function field(label: string, value: string) {
  return {
    is_short: true,
    text: {
      tag: 'lark_md',
      content: `**${escapeMarkdown(label)}**\n${escapeMarkdown(value)}`,
    },
  };
}

function cardBase(
  title: string,
  subtitle: string,
  template: CardTemplate,
  tagText: string,
  elements: object[],
) {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      enable_forward: false,
      summary: { content: title },
    },
    header: {
      title: { tag: 'plain_text', content: title },
      subtitle: { tag: 'plain_text', content: subtitle },
      template,
      icon: { tag: 'standard_icon', token: 'calendar_colorful' },
      text_tag_list: [
        {
          tag: 'text_tag',
          text: { tag: 'plain_text', content: tagText },
          color:
            template === 'green'
              ? 'green'
              : template === 'red'
                ? 'red'
                : template === 'orange'
                  ? 'orange'
                  : 'neutral',
        },
      ],
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '12px',
      elements,
    },
  };
}

function operationText(operation: CalendarOperation, hasConflict: boolean) {
  if (operation === 'create') {
    return hasConflict
      ? { primary: '仍然创建', secondary: '暂不创建' }
      : { primary: '确认创建', secondary: '取消' };
  }
  if (operation === 'update' || operation === 'update_future') {
    return hasConflict
      ? { primary: '仍然修改', secondary: '暂不修改' }
      : { primary: '确认修改', secondary: '取消' };
  }
  return { primary: '确认取消', secondary: '保留日程' };
}

export function buildPendingCalendarCard(input: PendingCalendarCardInput) {
  const hasConflict = input.conflicts.length > 0;
  const labels = operationText(input.operation, hasConflict);
  const details = [
    field('事项', input.summary),
    field('时间', input.timeText),
    field('颜色', input.colorName),
    ...(input.location ? [field('地点', input.location)] : []),
    ...(input.recurrenceText ? [field('重复', input.recurrenceText)] : []),
    ...(input.details || []).map((item) => field(item.label, item.value)),
  ];
  const elements: object[] = [
    { tag: 'div', fields: details },
  ];
  if (hasConflict) {
    elements.push({
      tag: 'markdown',
      content: `**发现时间冲突**\n${input.conflicts
        .map((item) => `- ${escapeMarkdown(item)}`)
        .join('\n')}\n<font color='grey'>机器人不会自动调整时间。</font>`,
      text_size: 'normal',
    });
  } else if (input.red) {
    elements.push({
      tag: 'markdown',
      content:
        "**红色事项需要确认**\n<font color='grey'>确认前不会写入飞书日历。</font>",
      text_size: 'normal',
    });
  } else if (
    (input.operation === 'cancel' || input.operation === 'cancel_future') &&
    input.restorable === false
  ) {
    elements.push({
      tag: 'markdown',
      content:
        "**取消后不可一键恢复**\n<font color='grey'>该日程不是机器人创建的普通个人日程。</font>",
      text_size: 'normal',
    });
  }
  elements.push(
    {
      tag: 'button',
      text: { tag: 'plain_text', content: labels.primary },
      type:
        input.operation === 'cancel' || input.operation === 'cancel_future'
          ? 'danger_filled'
          : 'primary_filled',
      width: 'fill',
      behaviors: [
        { type: 'callback', value: actionValue(input.actionId, 'confirm') },
      ],
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: labels.secondary },
      type: 'default',
      width: 'fill',
      behaviors: [
        { type: 'callback', value: actionValue(input.actionId, 'decline') },
      ],
    },
    {
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: `有效期至 ${formatShanghaiDateTime(new Date(input.expiresAt))}`,
        text_size: 'notation',
        text_color: 'grey',
        lines: 1,
      },
    },
  );

  const title = hasConflict
    ? input.red
      ? '红色日程与现有安排冲突'
      : '发现日程冲突'
    : input.operation === 'cancel' || input.operation === 'cancel_future'
      ? '取消日程待确认'
      : input.red
        ? '红色日程待确认'
        : '日程操作待确认';
  return cardBase(
    title,
    '请核对后选择',
    input.red ? 'red' : hasConflict ? 'orange' : 'blue',
    '待处理',
    elements,
  );
}

export function buildSuccessCalendarCard(input: SuccessCalendarCardInput) {
  const elements: object[] = [
    {
      tag: 'div',
      fields: [
        field('事项', input.summary),
        field('时间', input.timeText),
        ...(input.colorName ? [field('颜色', input.colorName)] : []),
        ...(input.location ? [field('地点', input.location)] : []),
        ...(input.recurrenceText ? [field('重复', input.recurrenceText)] : []),
      ],
    },
  ];
  if (input.undoActionId && input.undoExpiresAt) {
    elements.push(
      {
        tag: 'markdown',
        content: `<font color='grey'>10 分钟内可撤销，按钮仅原操作人可用。</font>`,
        text_size: 'notation',
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '撤销本次操作' },
        type: 'danger',
        width: 'fill',
        behaviors: [
          {
            type: 'callback',
            value: actionValue(input.undoActionId, 'undo'),
          },
        ],
      },
    );
  }
  return cardBase(input.title, '已写入飞书日历', 'green', '成功', elements);
}

export function buildTerminalCalendarCard(input: TerminalCardInput) {
  const template: CardTemplate =
    input.status === 'success'
      ? 'green'
      : input.status === 'failed'
        ? 'red'
        : 'grey';
  return cardBase(input.title, '该卡片已结束', template, '已处理', [
    {
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: input.message,
        lines: 4,
      },
    },
  ]);
}

function formatShanghaiDateTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replaceAll('/', '-');
}
