import { buildCalendarSearchExpansionCard } from './calendar-update-card';

describe('calendar-update-card', () => {
  it('提供继续查两年和取消两个回调按钮', () => {
    const card = buildCalendarSearchExpansionCard({
      actionId: 'act_search',
      keyword: '月婷吃饭',
      searchedRange: '2026-07-19 17:00 至 2026-08-18 17:00',
      expiresAt: '2026-07-20T09:00:00.000Z',
    });

    const text = JSON.stringify(card);
    expect(text).toContain('未来 30 天未找到');
    expect(text).toContain('2026-07-19 17:00 至 2026-08-18 17:00');
    expect(text).toContain('继续查未来两年');
    expect(text).toContain('search_two_years');
    expect(text).toContain('取消查找');
    expect(text).toContain('cancel_search');
    expect(card.schema).toBe('2.0');
    expect(card.config.update_multi).toBe(true);
    expect(card.config.enable_forward).toBe(false);
  });

  it('按钮只携带服务端动作编号和决定值', () => {
    const card = buildCalendarSearchExpansionCard({
      actionId: 'act_search',
      keyword: '月婷吃饭',
      searchedRange: '2026-07-19 至 2026-08-18',
      expiresAt: '2026-07-20T09:00:00.000Z',
    });

    const values = card.body.elements
      .filter((element) => element.tag === 'button')
      .map((element) => element.behaviors?.[0]?.value);
    expect(values).toEqual([
      { actionId: 'act_search', decision: 'search_two_years' },
      { actionId: 'act_search', decision: 'cancel_search' },
    ]);
  });
});
