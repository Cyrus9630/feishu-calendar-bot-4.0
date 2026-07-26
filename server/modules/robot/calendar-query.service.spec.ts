import { CalendarQueryService } from './calendar-query.service';

describe('CalendarQueryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TARGET_OPEN_ID: 'ou_owner',
      CHAT_ID: 'oc_target',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('按颜色筛选并把查询结果回复为卡片', async () => {
    const events = [
      {
        eventId: 'red',
        summary: '开庭',
        color: 0xf54a45,
        startTime: new Date('2026-07-17T02:00:00Z'),
        endTime: new Date('2026-07-17T03:00:00Z'),
        allDay: false,
      },
      {
        eventId: 'blue',
        summary: '会议',
        color: 0x3370ff,
        startTime: new Date('2026-07-17T04:00:00Z'),
        endTime: new Date('2026-07-17T05:00:00Z'),
        allDay: false,
      },
    ];
    const feishu = {
      listCalendarEvents: jest.fn().mockResolvedValue(events),
      replyInteractiveCard: jest.fn().mockResolvedValue('om_card'),
    };
    const store = {
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      saveCalendarCardReference: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CalendarQueryService(feishu as never, store as never);
    await service.reply('om_query', {
      start: new Date('2026-07-16T05:00:00Z'),
      end: new Date('2027-07-16T05:00:00Z'),
      label: '未来一年红色日程',
      color: 0xf54a45,
      colorName: '红色',
    });
    expect(feishu.replyInteractiveCard).toHaveBeenCalledWith(
      'om_query',
      expect.objectContaining({
        header: expect.objectContaining({
          subtitle: expect.objectContaining({ content: '未来一年红色日程' }),
        }),
      }),
      expect.any(String),
    );
    expect(store.saveCardAction).toHaveBeenCalledTimes(1);
    expect(store.bindCardMessage).toHaveBeenCalledWith(
      expect.any(String),
      'om_card',
    );
    expect(store.saveCalendarCardReference).toHaveBeenCalledWith('om_card', {
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      eventIds: ['red'],
    });
  });

  it('汇总卡只绑定卡片中实际展示的前二十项并去重', async () => {
    const events = Array.from({ length: 22 }, (_, index) => ({
      eventId: index === 1 ? 'evt_0' : `evt_${index}`,
      summary: `日程 ${index}`,
      startTime: new Date(
        `2026-07-${String(index + 1).padStart(2, '0')}T02:00:00Z`,
      ),
      endTime: new Date(
        `2026-07-${String(index + 1).padStart(2, '0')}T03:00:00Z`,
      ),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    }));
    const feishu = {
      sendInteractiveCard: jest.fn().mockResolvedValue('om_summary'),
    };
    const store = {
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      saveCalendarCardReference: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CalendarQueryService(feishu as never, store as never);

    await service.push(
      'oc_target',
      {
        start: new Date('2026-07-01T00:00:00Z'),
        end: new Date('2026-08-01T00:00:00Z'),
        label: '7 月日程',
      },
      events,
      '日程安排',
      'ou_owner',
      'summary-key',
    );

    expect(store.saveCalendarCardReference).toHaveBeenCalledWith('om_summary', {
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      eventIds: [
        'evt_0',
        ...Array.from({ length: 18 }, (_, index) => `evt_${index + 2}`),
      ],
    });
    expect(
      store.saveCalendarCardReference.mock.calls[0][1].eventIds,
    ).not.toContain('evt_20');
    expect(
      store.saveCalendarCardReference.mock.calls[0][1].eventIds,
    ).not.toContain('evt_21');
  });

  it('卡片引用保存失败时不把已经发送的查询卡改报失败', async () => {
    const event = {
      eventId: 'evt_1',
      summary: '开庭',
      startTime: new Date('2026-07-17T02:00:00Z'),
      endTime: new Date('2026-07-17T03:00:00Z'),
      allDay: false,
    };
    const feishu = {
      listCalendarEvents: jest.fn().mockResolvedValue([event]),
      replyInteractiveCard: jest.fn().mockResolvedValue('om_card'),
    };
    const store = {
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      saveCalendarCardReference: jest
        .fn()
        .mockRejectedValue(new Error('reference unavailable')),
    };
    const service = new CalendarQueryService(feishu as never, store as never);

    await expect(
      service.reply('om_query', {
        start: new Date('2026-07-17T00:00:00Z'),
        end: new Date('2026-07-18T00:00:00Z'),
        label: '今日日程',
      }),
    ).resolves.toBeUndefined();
    expect(feishu.replyInteractiveCard).toHaveBeenCalledTimes(1);
  });
});
