import type { CalendarEventRecord } from './feishu.service';

export interface AgendaCardItem {
  event: CalendarEventRecord;
  manageActionId?: string;
}

export interface AgendaCardInput {
  title: string;
  rangeLabel: string;
  items: AgendaCardItem[];
  total: number;
  mentionOpenId?: string;
}

function escapeMarkdown(value: string) {
  return value.replace(
    /[\\*~><\[\]()#:_]/g,
    (char) => `&#${char.charCodeAt(0)};`,
  );
}

function dateText(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('/', '-');
}

function timeText(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatAgendaEvent(event: CalendarEventRecord) {
  if (event.allDay) {
    const inclusiveEnd = new Date(event.endTime.getTime() - 1);
    const date =
      dateText(event.startTime) === dateText(inclusiveEnd)
        ? `${dateText(event.startTime)} 全天`
        : `${dateText(event.startTime)} 至 ${dateText(inclusiveEnd)} 全天`;
    return `${date}｜${event.summary}${event.location ? `｜${event.location}` : ''}`;
  }
  const sameDay = dateText(event.startTime) === dateText(event.endTime);
  const time = sameDay
    ? `${dateText(event.startTime)} ${timeText(event.startTime)}-${timeText(event.endTime)}`
    : `${dateText(event.startTime)} ${timeText(event.startTime)} 至 ${dateText(event.endTime)} ${timeText(event.endTime)}`;
  return `${time}｜${event.summary}${event.location ? `｜${event.location}` : ''}`;
}

export function buildAgendaCard(input: AgendaCardInput) {
  const elements: object[] = [];
  if (input.mentionOpenId) {
    elements.push({
      tag: 'markdown',
      content: `<at id=${input.mentionOpenId}></at> 请查看以下安排：`,
    });
  }
  if (input.items.length === 0) {
    elements.push({
      tag: 'div',
      text: { tag: 'plain_text', content: '没有符合条件的日程。' },
    });
  }
  input.items.forEach(({ event, manageActionId }, index) => {
    elements.push({
      tag: 'markdown',
      content: `**${index + 1}. ${escapeMarkdown(event.summary)}**\n${escapeMarkdown(formatAgendaEvent(event))}`,
    });
    if (manageActionId) {
      elements.push({
        tag: 'button',
        text: { tag: 'plain_text', content: `管理第 ${index + 1} 项` },
        type: 'default',
        width: 'fill',
        behaviors: [
          {
            type: 'callback',
            value: { actionId: manageActionId, decision: 'manage' },
          },
        ],
      });
    }
  });
  if (input.total > input.items.length) {
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>共 ${input.total} 项，本卡展示前 ${input.items.length} 项，请缩小查询范围查看其余日程。</font>`,
    });
  }
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      enable_forward: false,
      summary: { content: input.title },
    },
    header: {
      title: { tag: 'plain_text', content: input.title },
      subtitle: { tag: 'plain_text', content: input.rangeLabel },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'calendar_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '10px',
      elements,
    },
  };
}

export function buildAgendaManageCard(input: {
  event: CalendarEventRecord;
  actions: Record<
    'postpone_hour' | 'tomorrow_10' | 'cancel_event' | 'back_agenda',
    string
  >;
}) {
  const button = (
    text: string,
    decision: keyof typeof input.actions,
    danger = false,
  ) => ({
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type: danger ? 'danger' : 'default',
    width: 'fill',
    behaviors: [
      {
        type: 'callback',
        value: { actionId: input.actions[decision], decision },
      },
    ],
  });
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      enable_forward: false,
      summary: { content: `管理日程：${input.event.summary}` },
    },
    header: {
      title: { tag: 'plain_text', content: `管理日程：${input.event.summary}` },
      subtitle: { tag: 'plain_text', content: formatAgendaEvent(input.event) },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'calendar_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '10px',
      elements: [
        button('推迟 1 小时', 'postpone_hour'),
        button('移到明天 10:00', 'tomorrow_10'),
        button('取消日程', 'cancel_event', true),
        button('返回日程列表', 'back_agenda'),
      ],
    },
  };
}
