export interface CalendarSearchExpansionCardInput {
  actionId: string;
  keyword: string;
  searchedRange: string;
  expiresAt: string;
}

function escapeMarkdown(value: string) {
  return value.replace(
    /[\\*~><\[\]()#:_]/g,
    (char) => `&#${char.charCodeAt(0)};`,
  );
}

export function buildCalendarSearchExpansionCard(
  input: CalendarSearchExpansionCardInput,
) {
  const button = (
    text: string,
    decision: 'search_two_years' | 'cancel_search',
    type: 'primary' | 'default',
  ) => ({
    tag: 'button' as const,
    text: { tag: 'plain_text', content: text },
    type,
    width: 'fill',
    behaviors: [
      {
        type: 'callback',
        value: { actionId: input.actionId, decision },
      },
    ],
  });

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      enable_forward: false,
      summary: { content: `未找到日程：${input.keyword}` },
    },
    header: {
      title: { tag: 'plain_text', content: '未来 30 天未找到日程' },
      subtitle: { tag: 'plain_text', content: input.keyword },
      template: 'orange',
      icon: { tag: 'standard_icon', token: 'calendar_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '10px',
      elements: [
        {
          tag: 'markdown' as const,
          content: `没有找到标题包含 **${escapeMarkdown(input.keyword)}** 的日程。\n已检索范围：${input.searchedRange}`,
        },
        {
          tag: 'markdown' as const,
          content:
            '继续后会查到基准日起两年；找到远期日程后，仍需由你选择确认。',
        },
        {
          tag: 'markdown' as const,
          content: `<font color='grey'>本次选择有效至 ${input.expiresAt}</font>`,
        },
        button('继续查未来两年', 'search_two_years', 'primary'),
        button('取消查找', 'cancel_search', 'default'),
      ],
    },
  };
}
