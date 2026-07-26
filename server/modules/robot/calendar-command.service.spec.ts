import { CalendarCommandService } from './calendar-command.service';

describe('CalendarCommandService', () => {
  const reference = new Date('2026-07-14T05:00:00.000Z');
  const input = {
    kind: 'text' as const,
    messageId: 'om_text',
    parentId: null,
    text: '17号上午7点体检 黄色',
  };

  function setup(
    raw: Record<string, unknown> | Record<string, unknown>[],
    events: any[] = [],
  ) {
    const call = jest.fn();
    if (Array.isArray(raw)) {
      raw.forEach((item) => call.mockResolvedValueOnce(item));
    } else {
      call.mockResolvedValue(raw);
    }
    const capability = { load: jest.fn(() => ({ call })) };
    const feishu = {
      listCalendarEvents: jest.fn().mockResolvedValue(events),
      createCalendarEvent: jest.fn().mockResolvedValue('evt_1'),
      patchCalendarEvent: jest.fn().mockResolvedValue(undefined),
      deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
      replyInteractiveCard: jest.fn().mockResolvedValue('om_search_card'),
      updateInteractiveCard: jest.fn().mockResolvedValue(undefined),
      getCalendarEvent: jest
        .fn()
        .mockImplementation(
          async (eventId: string) =>
            events.find((event) => event.eventId === eventId) || null,
        ),
    };
    const store = {
      savePending: jest.fn().mockResolvedValue(undefined),
      completePending: jest.fn().mockResolvedValue(undefined),
      recordCreatedEvent: jest.fn().mockResolvedValue(undefined),
      getRecentCreatedEvent: jest.fn().mockResolvedValue(null),
      getCreatedEventById: jest.fn().mockResolvedValue(null),
      getLatestPendingCancellationSelection: jest.fn().mockResolvedValue(null),
      getCalendarCardReference: jest.fn().mockResolvedValue([]),
      claimPending: jest.fn().mockResolvedValue({ state: 'missing' }),
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      getCardAction: jest.fn().mockResolvedValue(null),
      claimCardAction: jest.fn().mockResolvedValue({ state: 'missing' }),
      completeCardAction: jest.fn().mockResolvedValue(undefined),
    };
    const actions = {
      promptMutation: jest.fn().mockResolvedValue('om_card'),
      executeDirect: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn((event) => ({
        eventId: event.eventId,
        summary: event.summary,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        color: event.color ?? 0x3370ff,
        colorName: event.color === 0xf54a45 ? '红色' : '蓝色',
        reminders: event.reminders ?? [30],
        recurrence: event.recurrence,
        recurrenceText: event.recurrence ? '每3个月' : undefined,
      })),
    };
    const queries = {
      reply: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new CalendarCommandService(
        capability as never,
        feishu as never,
        store as never,
        actions as never,
        queries as never,
      ),
      feishu,
      store,
      actions,
      queries,
      parseCall: call,
    };
  }

  it('创建黄色体检日程并返回完整结果', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '体检',
      date: '17号',
      start_time: '上午7点',
      end_time: '',
      duration_minutes: 0,
      color: '黄色',
      location: '',
      reminder_minutes: '',
    });
    await service.handleText(input, reference);
    expect(actions.executeDirect).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '体检',
          color: 0xffc60a,
          reminders: [30],
        }),
      }),
    );
  });

  it('日程查询不调用 AI，直接交给查询服务', async () => {
    const { service, queries, actions } = setup({
      action: 'create',
      title: '不应调用',
      date: '明天',
      start_time: '上午',
    });
    await service.handleText({ ...input, text: '我明天什么安排' }, reference);
    expect(queries.reply).toHaveBeenCalledWith(
      input.messageId,
      expect.objectContaining({ label: '明日日程' }),
    );
    expect(actions.executeDirect).not.toHaveBeenCalled();
  });

  it('中文日期、自由语序和礼貌词在调用 AI 前统一规范化', async () => {
    const { service, parseCall, actions } = setup({
      action: 'create',
      title: '开庭',
      date: '7月23号',
      start_time: '上午9点15分',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '麻烦帮我记一下，开庭，七月二十三号上午九点一刻' },
      reference,
    );

    expect(parseCall).toHaveBeenCalledWith('textToJson', {
      schedule_text: '开庭，7月23号上午9点15分',
    });
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '开庭',
          startTime: '2026-07-23T01:15:00.000Z',
        }),
      }),
    );
  });

  it('自然时长覆盖 AI 的默认时长', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '开会',
      date: '明天',
      start_time: '下午3点',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '明天下午三点开会一个半小时' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2026-07-15T07:00:00.000Z',
          endTime: '2026-07-15T08:30:00.000Z',
        }),
      }),
    );
  });

  it('确定的否定表达在调用 AI 前转成取消指令', async () => {
    const event = {
      eventId: 'evt_meeting',
      summary: '开会',
      startTime: new Date('2026-07-15T14:00:00+08:00'),
      endTime: new Date('2026-07-15T15:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const { service, parseCall, actions } = setup(
      {
        action: 'cancel',
        title: '开会',
        date: '明天',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [event],
    );

    await service.handleText({ ...input, text: '明天不开会了' }, reference);

    expect(parseCall).toHaveBeenCalledWith('textToJson', {
      schedule_text: '取消明天开会',
    });
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'cancel', eventId: 'evt_meeting' }),
    );
  });

  it('歧义时间在调用 AI 前被拒绝并反馈', async () => {
    const { service, parseCall, feishu, actions } = setup({
      action: 'create',
      title: '开会',
      date: '明天',
      start_time: '下午3点',
    });

    await service.handleText(
      { ...input, text: '明天下午三四点开会' },
      reference,
    );

    expect(parseCall).not.toHaveBeenCalled();
    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      input.messageId,
      expect.stringContaining('明确一个具体钟点'),
      expect.any(String),
    );
  });

  it('批量事项继承日期且每项保留自己的自然时长', async () => {
    const { service, actions } = setup([
      {
        action: 'create',
        title: '体检',
        date: '明天',
        start_time: '上午',
        duration_minutes: 0,
        color: '',
      },
      {
        action: 'create',
        title: '开会',
        date: '明天',
        start_time: '下午',
        duration_minutes: 0,
        color: '',
      },
    ]);

    await service.handleText(
      { ...input, text: '明天上午体检一个半小时，下午开会' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '体检',
          startTime: '2026-07-15T02:00:00.000Z',
          endTime: '2026-07-15T03:30:00.000Z',
        }),
      }),
    );
    expect(actions.executeDirect).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '开会',
          startTime: '2026-07-15T06:00:00.000Z',
          endTime: '2026-07-15T07:00:00.000Z',
        }),
      }),
    );
  });

  it('创建包含结束日的全天跨日日程', async () => {
    const { service, actions, feishu } = setup({
      action: 'create',
      title: '出差',
      date: '7月20日',
      start_time: '',
      end_time: '',
      duration_minutes: 0,
      color: '',
      location: '上海',
    });

    await service.handleText(
      { ...input, text: '7月20日至22日出差 上海' },
      reference,
    );

    expect(feishu.listCalendarEvents).toHaveBeenCalledWith(
      new Date('2026-07-19T16:00:00.000Z'),
      new Date('2026-07-22T16:00:00.000Z'),
    );
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '出差',
          startTime: '2026-07-19T16:00:00.000Z',
          endTime: '2026-07-22T16:00:00.000Z',
          allDay: true,
        }),
      }),
    );
  });

  it('两位年份创建时固定映射为 2027 年', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '结婚纪念日',
      date: '27年5月7日',
      start_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '27年5月7日结婚纪念日' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2027-05-07T02:00:00.000Z',
        }),
      }),
    );
  });

  it('每年事项从下一次有效日期开始，默认黄色并直接创建', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '每年结婚纪念日',
      date: '5月7日',
      start_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '每年5月7日结婚纪念日' },
      reference,
    );

    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'create',
        after: expect.objectContaining({
          summary: '结婚纪念日',
          startTime: '2027-05-07T02:00:00.000Z',
          color: 0xffc60a,
          colorName: '黄色',
          recurrence: 'FREQ=YEARLY;INTERVAL=1',
          recurrenceText: '每年5月7日',
        }),
      }),
    );
  });

  it('明确首次日期时创建默认黄色的每三个月重复日程', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '每三个月交房租',
      date: '7月28日',
      start_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '7月28日每三个月交房租' },
      reference,
    );

    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '交房租',
          startTime: '2026-07-28T02:00:00.000Z',
          color: 0xffc60a,
          colorName: '黄色',
          recurrence: 'FREQ=MONTHLY;INTERVAL=3',
          recurrenceText: '每3个月',
        }),
      }),
    );
  });

  it('重复日程明确说蓝色时保留蓝色并直接创建', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '每年结婚纪念日',
      date: '5月7日',
      start_time: '',
      duration_minutes: 0,
      color: '蓝色',
    });

    await service.handleText(
      { ...input, text: '每年5月7日结婚纪念日 蓝色' },
      reference,
    );

    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({ color: 0x3370ff, colorName: '蓝色' }),
      }),
    );
  });

  it('红色重复日程仍需确认', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '每年重要事项',
      date: '8月7日',
      start_time: '',
      duration_minutes: 0,
      color: '红色',
    });

    await service.handleText(
      { ...input, text: '每年8月7日重要事项 红色' },
      reference,
    );

    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ red: true }),
    );
  });

  it('默认黄色重复日程发生冲突时仍需确认', async () => {
    const existing = {
      eventId: 'evt_conflict',
      summary: '已有事项',
      startTime: new Date('2026-08-07T10:00:00+08:00'),
      endTime: new Date('2026-08-07T11:00:00+08:00'),
      allDay: false,
    };
    const { service, actions } = setup(
      {
        action: 'create',
        title: '每年纪念日',
        date: '8月7日',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );

    await service.handleText({ ...input, text: '每年8月7日纪念日' }, reference);

    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({ colorName: '黄色' }),
        conflicts: [existing],
      }),
    );
  });

  it('按月重复没有首次日期时明确拒绝且不创建', async () => {
    const { service, actions, feishu } = setup({
      action: 'create',
      title: '每三个月交房租',
      date: '',
      start_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText({ ...input, text: '每三个月交房租' }, reference);

    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('按月重复日程需要明确首次日期'),
      expect.any(String),
    );
  });

  it('删除重复日程未说明范围时不生成删除确认卡', async () => {
    const existing = {
      eventId: 'evt_recurring',
      summary: '交房租',
      startTime: new Date('2026-07-28T10:00:00+08:00'),
      endTime: new Date('2026-07-28T11:00:00+08:00'),
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
      allDay: false,
    };
    const { service, actions, feishu } = setup(
      {
        action: 'cancel',
        title: '交房租',
        date: '7月28日',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );

    await service.handleText(
      { ...input, text: '删除7月28日交房租' },
      reference,
    );

    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('请明确作用范围'),
      expect.any(String),
    );
  });

  it('删除本次及后续时截断原系列而不删除历史实例', async () => {
    const instance = {
      eventId: 'rent_1785204000',
      recurringEventId: 'rent_0',
      summary: '交房租',
      startTime: new Date('2026-07-28T10:00:00+08:00'),
      endTime: new Date('2026-07-28T11:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const master = {
      ...instance,
      eventId: 'rent_0',
      recurringEventId: undefined,
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
    };
    const { service, actions, feishu } = setup(
      {
        action: 'cancel',
        title: '交房租',
        date: '7月28日',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [instance],
    );
    feishu.getCalendarEvent.mockImplementation(async (eventId: string) =>
      eventId === instance.eventId
        ? instance
        : eventId === master.eventId
          ? master
          : null,
    );

    await service.handleText(
      { ...input, text: '删除7月28日交房租本次及后续' },
      reference,
    );

    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'cancel_future',
        eventId: 'rent_0',
        truncatedRecurrence: expect.stringContaining('UNTIL='),
        display: expect.objectContaining({ eventId: instance.eventId }),
      }),
    );
  });

  it('修改全部重复日程时操作主系列', async () => {
    const instance = {
      eventId: 'rent_1785204000',
      recurringEventId: 'rent_0',
      summary: '交房租',
      startTime: new Date('2026-07-28T10:00:00+08:00'),
      endTime: new Date('2026-07-28T11:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const master = {
      ...instance,
      eventId: 'rent_0',
      recurringEventId: undefined,
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
    };
    const { service, actions, feishu } = setup(
      {
        action: 'update',
        title: '交房租',
        date: '7月28日',
        start_time: '下午3点',
        duration_minutes: 0,
        color: '',
        location: '',
      },
      [instance],
    );
    feishu.getCalendarEvent.mockResolvedValue(master);

    await service.handleText(
      { ...input, text: '把7月28日交房租全部改到下午3点' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'update',
        eventId: 'rent_0',
        after: expect.objectContaining({
          recurrence: 'FREQ=MONTHLY;INTERVAL=3',
        }),
      }),
    );
  });

  it.each([
    ['17号', '2026-07-17T02:00:00.000Z'],
    ['明天', '2026-07-15T02:00:00.000Z'],
    ['7月20日', '2026-07-20T02:00:00.000Z'],
    ['本周五', '2026-07-17T02:00:00.000Z'],
    ['下周一', '2026-07-20T02:00:00.000Z'],
    ['周三', '2026-07-15T02:00:00.000Z'],
    ['周二', '2026-07-21T02:00:00.000Z'],
    ['下下周三', '2026-07-29T02:00:00.000Z'],
  ])('%s 只有日期和事项时默认创建 10:00 日程', async (date, expected) => {
    const { service, actions } = setup({
      action: 'create',
      title: '体检',
      date,
      start_time: '',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });
    await service.handleText({ ...input, text: `${date}体检` }, reference);
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '体检',
          startTime: expected,
          endTime: new Date(
            new Date(expected).getTime() + 60 * 60 * 1000,
          ).toISOString(),
          color: 0x3370ff,
        }),
      }),
    );
  });

  it('没有日期时使用当天，且忽略 AI 补造的日期', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '开会',
      date: '明天',
      start_time: '下午3点',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText({ ...input, text: '下午3点开会' }, reference);

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2026-07-14T07:00:00.000Z',
        }),
      }),
    );
  });

  it('十天后未写钟点时按目标日 10:00 创建', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '确认三撤案是否上诉',
      date: '今天',
      start_time: '',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '十天后确认三撤案是否上诉' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '确认三撤案是否上诉',
          startTime: '2026-07-24T02:00:00.000Z',
          endTime: '2026-07-24T03:00:00.000Z',
        }),
      }),
    );
  });

  it('三小时后从消息时刻直接增加三小时', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '电话会议',
      date: '',
      start_time: '下午4点',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '3小时后电话会议' },
      new Date('2026-07-14T05:37:42.789Z'),
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2026-07-14T08:37:00.000Z',
          endTime: '2026-07-14T09:37:00.000Z',
        }),
      }),
    );
  });

  it('今天说裸周几时固定顺延到下一周，不比较当前时刻', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '开会',
      date: '周二',
      start_time: '下午3点',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText({ ...input, text: '周二下午3点开会' }, reference);

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2026-07-21T07:00:00.000Z',
        }),
      }),
    );
  });

  it('AI 把事项中的“默认时间”误提取为钟点时仍按 10:00 创建', async () => {
    const { service, actions } = setup({
      action: 'create',
      title: '默认时间验收',
      date: '17号',
      start_time: '默认时间',
      end_time: '',
      duration_minutes: 0,
      color: '',
    });
    await service.handleText({ ...input, text: '17号默认时间验收' }, reference);
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          summary: '默认时间验收',
          startTime: '2026-07-17T02:00:00.000Z',
          endTime: '2026-07-17T03:00:00.000Z',
        }),
      }),
    );
  });

  it('同标题同开始时间时不重复创建', async () => {
    const existing = {
      eventId: 'evt_old',
      summary: '体检',
      startTime: new Date('2026-07-17T07:00:00+08:00'),
      endTime: new Date('2026-07-17T08:00:00+08:00'),
      allDay: false,
    };
    const { service, feishu } = setup(
      {
        action: 'create',
        title: '体检',
        date: '17号',
        start_time: '上午7点',
        duration_minutes: 0,
        color: '黄色',
      },
      [existing],
    );
    await service.handleText(input, reference);
    expect(feishu.createCalendarEvent).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('该日程已存在'),
      expect.any(String),
    );
  });

  it('取消唯一匹配项时只生成待确认记录', async () => {
    const existing = {
      eventId: 'evt_old',
      summary: '体检',
      startTime: new Date('2026-07-17T07:00:00+08:00'),
      endTime: new Date('2026-07-17T08:00:00+08:00'),
      allDay: false,
    };
    const { service, feishu, actions, store } = setup(
      {
        action: 'cancel',
        title: '体检',
        date: '17号',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );
    await service.handleText({ ...input, text: '取消17号体检' }, reference);
    expect(feishu.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'cancel', eventId: 'evt_old' }),
    );
  });

  it('AI 给出原文不存在的修改时间时不改变日程时间', async () => {
    const existing = {
      eventId: 'evt_old',
      summary: '体检',
      startTime: new Date('2026-07-17T07:00:00+08:00'),
      endTime: new Date('2026-07-17T08:00:00+08:00'),
      allDay: false,
    };
    const { service, actions } = setup(
      {
        action: 'update',
        title: '体检',
        date: '17号',
        start_time: '上午10点',
        color: '红色',
        duration_minutes: 0,
      },
      [existing],
    );
    await service.handleText(
      { ...input, text: '把17号体检改为红色' },
      reference,
    );
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: 'update',
        red: true,
        after: expect.objectContaining({
          color: 0xf54a45,
          startTime: '2026-07-16T23:00:00.000Z',
        }),
      }),
    );
  });

  it('修改时分离原日期和新日期', async () => {
    const existing = {
      eventId: 'evt_old',
      summary: '体检',
      startTime: new Date('2026-07-17T07:00:00+08:00'),
      endTime: new Date('2026-07-17T08:00:00+08:00'),
      allDay: false,
    };
    const { service, actions } = setup(
      {
        action: 'update',
        title: '体检',
        date: '18号',
        start_time: '上午8点',
        end_time: '',
        duration_minutes: 0,
        color: '',
        location: '',
      },
      [existing],
    );

    await service.handleText(
      { ...input, text: '把17号体检改到18号上午8点' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: 'evt_old',
        after: expect.objectContaining({
          startTime: '2026-07-18T00:00:00.000Z',
          endTime: '2026-07-18T01:00:00.000Z',
        }),
      }),
    );
  });

  it('未写原日期时在未来30天模糊查找唯一日程', async () => {
    const fuzzyReference = new Date('2026-07-19T09:00:00+08:00');
    const existing = {
      eventId: 'evt_meal',
      summary: '和月婷吃饭',
      startTime: new Date('2026-07-21T19:00:00+08:00'),
      endTime: new Date('2026-07-21T20:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const { service, feishu, actions } = setup(
      {
        action: 'update',
        title: '和月婷吃饭',
        date: '周三',
        start_time: '',
        end_time: '',
        duration_minutes: 0,
        color: '',
        location: '',
      },
      [existing],
    );

    await service.handleText(
      { ...input, text: '和月婷吃饭改到周三' },
      fuzzyReference,
    );

    expect(feishu.listCalendarEvents).toHaveBeenNthCalledWith(
      1,
      fuzzyReference,
      new Date('2026-08-18T09:00:00+08:00'),
    );
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: 'evt_meal',
        after: expect.objectContaining({
          startTime: '2026-07-22T11:00:00.000Z',
          endTime: '2026-07-22T12:00:00.000Z',
        }),
      }),
    );
  });

  it('模糊查找命中多条时保存可单选的修改候选', async () => {
    const events = [
      {
        eventId: 'evt_1',
        summary: '和月婷吃饭',
        startTime: new Date('2026-07-21T19:00:00+08:00'),
        endTime: new Date('2026-07-21T20:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_2',
        summary: '与月婷吃饭',
        startTime: new Date('2026-07-25T19:00:00+08:00'),
        endTime: new Date('2026-07-25T20:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, store, actions, feishu } = setup(
      {
        action: 'update',
        title: '月婷吃饭',
        date: '周三',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      events,
    );

    await service.handleText(
      { ...input, text: '月婷吃饭改周三' },
      new Date('2026-07-19T09:00:00+08:00'),
    );

    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      input.messageId,
      expect.stringContaining('只发送一个序号'),
      expect.any(String),
    );
    expect(store.savePending).toHaveBeenCalledWith(
      'om_reply',
      expect.objectContaining({
        kind: 'calendar_update_selection',
        candidates: expect.arrayContaining([
          expect.objectContaining({ eventId: 'evt_1' }),
          expect.objectContaining({ eventId: 'evt_2' }),
        ]),
      }),
    );
  });

  it('未来30天没有候选时发送继续查两年的选择卡', async () => {
    const { service, store, feishu, actions } = setup({
      action: 'update',
      title: '远期事项',
      date: '周三',
      start_time: '',
      duration_minutes: 0,
      color: '',
    });

    await service.handleText(
      { ...input, text: '远期事项改到周三' },
      new Date('2026-07-19T09:00:00+08:00'),
    );

    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(store.saveCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'calendar_search_expansion' }),
    );
    expect(feishu.replyInteractiveCard).toHaveBeenCalledWith(
      input.messageId,
      expect.any(Object),
      expect.any(String),
    );
    expect(store.bindCardMessage).toHaveBeenCalledWith(
      expect.any(String),
      'om_search_card',
    );
  });

  it('回复单日程卡片时直接使用卡片绑定的事件', async () => {
    const existing = {
      eventId: 'evt_card',
      summary: '和月婷吃饭',
      startTime: new Date('2026-07-21T19:00:00+08:00'),
      endTime: new Date('2026-07-21T20:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const { service, store, feishu, actions } = setup(
      {
        action: 'update',
        title: '这个',
        date: '周三',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );
    store.getCalendarCardReference.mockResolvedValue(['evt_card']);

    await service.handleText(
      {
        ...input,
        parentId: 'om_success_card',
        chatId: 'oc_target',
        senderOpenId: 'ou_owner',
        text: '这个改到周三',
      },
      new Date('2026-07-19T09:00:00+08:00'),
    );

    expect(store.getCalendarCardReference).toHaveBeenCalledWith(
      'om_success_card',
      'ou_owner',
      'oc_target',
    );
    expect(feishu.listCalendarEvents).toHaveBeenCalledTimes(1);
    expect(feishu.listCalendarEvents).toHaveBeenCalledWith(
      new Date('2026-07-21T16:00:00.000Z'),
      new Date('2026-07-22T15:59:59.999Z'),
    );
    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'evt_card' }),
    );
  });

  it('引用多项目卡片时任一日程已不存在就停止修改', async () => {
    const existing = {
      eventId: 'evt_existing',
      summary: '和月婷吃饭',
      startTime: new Date('2026-07-21T19:00:00+08:00'),
      endTime: new Date('2026-07-21T20:00:00+08:00'),
      allDay: false,
    };
    const { service, store, feishu, actions } = setup(
      {
        action: 'update',
        title: '这个',
        date: '周三',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );
    store.getCalendarCardReference.mockResolvedValue([
      'evt_existing',
      'evt_missing',
    ]);

    await service.handleText(
      {
        ...input,
        parentId: 'om_agenda_card',
        chatId: 'oc_target',
        senderOpenId: 'ou_owner',
        text: '这个改到周三',
      },
      new Date('2026-07-19T09:00:00+08:00'),
    );

    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      input.messageId,
      expect.stringContaining('已有项目不存在'),
      expect.any(String),
    );
  });

  it('回复一个有效序号后修改所选候选日程', async () => {
    const events = [
      {
        eventId: 'evt_1',
        summary: '和月婷吃饭',
        startTime: new Date('2026-07-21T19:00:00+08:00'),
        endTime: new Date('2026-07-21T20:00:00+08:00'),
        allDay: false,
        attendeeCount: 0,
        hasMeeting: false,
      },
      {
        eventId: 'evt_2',
        summary: '月婷吃饭安排',
        startTime: new Date('2026-07-25T19:00:00+08:00'),
        endTime: new Date('2026-07-25T20:00:00+08:00'),
        allDay: false,
        attendeeCount: 0,
        hasMeeting: false,
      },
    ];
    const { service, store, actions } = setup({}, events);
    const request = {
      sourceText: '月婷吃饭改周三',
      command: {
        action: 'update' as const,
        title: '月婷吃饭',
        dateText: '周三',
        startText: '',
        endText: '',
        durationMinutes: 60,
        color: { name: '蓝色' as const, rgb: 0x3370ff },
        colorExplicit: false,
        location: '',
        reminderMinutes: [30],
      },
      raw: {
        action: 'update' as const,
        title: '月婷吃饭',
        date: '周三',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      referenceTime: '2026-07-19T01:00:00.000Z',
    };

    const pending = {
      kind: 'calendar_update_selection' as const,
      request,
      candidates: events.map((event) => ({
        eventId: event.eventId,
        summary: event.summary,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
      expiresAt: '2026-07-20T01:00:00.000Z',
    };
    store.claimPending
      .mockResolvedValueOnce({ state: 'claimed', action: pending })
      .mockResolvedValueOnce({ state: 'completed' });

    await service.selectUpdateCandidate(
      { ...input, parentId: 'om_candidates', text: '2' },
      pending,
    );
    await service.selectUpdateCandidate(
      { ...input, messageId: 'om_repeat', parentId: 'om_candidates', text: '2' },
      pending,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'evt_2' }),
    );
    expect(store.completePending).toHaveBeenCalledWith(
      'om_candidates',
      'success',
      'selected',
    );
    expect(actions.executeDirect).toHaveBeenCalledTimes(1);
    expect(store.claimPending).toHaveBeenCalledTimes(2);
  });

  it('选择继续后查询第31天至两年并始终发送候选清单', async () => {
    const remote = {
      eventId: 'evt_remote',
      summary: '远期事项',
      startTime: new Date('2027-01-10T10:00:00+08:00'),
      endTime: new Date('2027-01-10T11:00:00+08:00'),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    };
    const { service, store, feishu, actions } = setup({}, [remote]);
    const request = {
      sourceText: '远期事项改到周三',
      command: {
        action: 'update' as const,
        title: '远期事项',
        dateText: '周三',
        startText: '',
        endText: '',
        durationMinutes: 60,
        color: { name: '蓝色' as const, rgb: 0x3370ff },
        colorExplicit: false,
        location: '',
        reminderMinutes: [30],
      },
      raw: {
        action: 'update' as const,
        title: '远期事项',
        date: '周三',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      referenceTime: '2026-07-19T01:00:00.000Z',
    };
    const action = {
      kind: 'calendar_search_expansion' as const,
      actionId: 'act-search',
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_search_card',
      request,
      expiresAt: '2026-07-20T01:00:00.000Z',
    };
    store.getCardAction.mockResolvedValue(action);
    store.claimCardAction.mockResolvedValue({ state: 'claimed', action });

    await service.handleSearchExpansionAction({
      kind: 'card_action',
      callbackId: 'cb_search',
      messageId: 'om_search_card',
      chatId: 'oc_target',
      operatorOpenId: 'ou_owner',
      actionId: 'act-search',
      decision: 'search_two_years',
    });

    expect(feishu.listCalendarEvents).toHaveBeenCalledWith(
      new Date('2026-08-18T01:00:00.000Z'),
      new Date('2028-07-19T01:00:00.000Z'),
    );
    expect(actions.executeDirect).not.toHaveBeenCalled();
    expect(store.savePending).toHaveBeenCalledWith(
      'om_reply',
      expect.objectContaining({
        kind: 'calendar_update_selection',
        candidates: [expect.objectContaining({ eventId: 'evt_remote' })],
      }),
    );
    expect(feishu.updateInteractiveCard).toHaveBeenCalledWith(
      'om_search_card',
      expect.any(Object),
    );
  });

  it('使用修改词之前的时间缩小原日程候选', async () => {
    const events = [
      {
        eventId: 'evt_7',
        summary: '体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_9',
        summary: '体检',
        startTime: new Date('2026-07-17T09:00:00+08:00'),
        endTime: new Date('2026-07-17T10:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, actions } = setup(
      {
        action: 'update',
        title: '体检',
        date: '17号',
        start_time: '8点',
        end_time: '',
        duration_minutes: 0,
        color: '',
        location: '',
      },
      events,
    );

    await service.handleText(
      { ...input, text: '把17号上午7点体检改到8点' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'evt_7' }),
    );
  });

  it('改名时使用旧标题定位并只写入新标题', async () => {
    const existing = {
      eventId: 'evt_old',
      summary: '体检',
      startTime: new Date('2026-07-17T07:00:00+08:00'),
      endTime: new Date('2026-07-17T08:00:00+08:00'),
      allDay: false,
    };
    const { service, actions } = setup(
      {
        action: 'update',
        title: '年度体检',
        date: '17号',
        start_time: '',
        end_time: '',
        duration_minutes: 0,
        color: '',
        location: '',
      },
      [existing],
    );

    await service.handleText(
      { ...input, text: '把17号体检改名为年度体检' },
      reference,
    );

    expect(actions.executeDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: 'evt_old',
        after: expect.objectContaining({ summary: '年度体检' }),
      }),
    );
  });

  it('当天下午取消未写时间的日程时不推测为上午10点', async () => {
    const existing = {
      eventId: 'evt_today',
      summary: '体检',
      startTime: new Date('2026-07-14T16:00:00+08:00'),
      endTime: new Date('2026-07-14T17:00:00+08:00'),
      allDay: false,
    };
    const { service, actions } = setup(
      {
        action: 'cancel',
        title: '体检',
        date: '今天',
        start_time: '上午10点',
        duration_minutes: 0,
        color: '',
      },
      [existing],
    );
    await service.handleText(
      { ...input, text: '取消今天体检' },
      new Date('2026-07-14T07:00:00.000Z'),
    );
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'evt_today' }),
    );
  });

  it('取消未写时间且同日有多个同名候选时要求补充，不自动选择', async () => {
    const events = [
      {
        eventId: 'evt_morning',
        summary: '体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_afternoon',
        summary: '体检',
        startTime: new Date('2026-07-17T15:00:00+08:00'),
        endTime: new Date('2026-07-17T16:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, feishu, actions, store } = setup(
      {
        action: 'cancel',
        title: '体检',
        date: '17号',
        start_time: '',
        duration_minutes: 0,
        color: '',
      },
      events,
    );
    await service.handleText({ ...input, text: '取消17号体检' }, reference);
    expect(actions.promptMutation).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('找到多条日程，尚未执行删除'),
      expect.any(String),
    );
    expect(store.savePending).toHaveBeenCalledWith(
      'om_reply',
      expect.objectContaining({
        kind: 'calendar_cancel_selection',
        candidates: expect.arrayContaining([
          expect.objectContaining({ eventId: 'evt_morning' }),
          expect.objectContaining({ eventId: 'evt_afternoon' }),
        ]),
      }),
    );
  });

  it('一条消息批量创建多个日程并反馈汇总', async () => {
    const { service, actions, feishu } = setup([
      {
        action: 'create',
        title: '体检',
        date: '17号',
        start_time: '上午7点',
        duration_minutes: 0,
        color: '黄色',
      },
      {
        action: 'create',
        title: '开会',
        date: '18号',
        start_time: '下午2点',
        duration_minutes: 0,
        color: '',
      },
    ]);
    await service.handleText(
      { ...input, text: '批量创建：17号上午7点体检 黄色；18号下午2点开会' },
      reference,
    );
    expect(actions.executeDirect).toHaveBeenCalledTimes(2);
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('批量创建处理完成：共2项'),
      expect.any(String),
    );
  });

  it('批量创建后项未写日期时继承前一项日期', async () => {
    const { service, actions } = setup([
      {
        action: 'create',
        title: '体检',
        date: '17号',
        start_time: '上午7点',
        duration_minutes: 0,
        color: '',
      },
      {
        action: 'create',
        title: '开会',
        date: '',
        start_time: '下午2点',
        duration_minutes: 0,
        color: '',
      },
    ]);
    await service.handleText(
      { ...input, text: '17号上午7点体检、下午2点开会' },
      reference,
    );
    expect(actions.executeDirect).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({
          startTime: '2026-07-17T06:00:00.000Z',
        }),
      }),
    );
  });

  it('批量删除多个唯一匹配项时分别生成确认卡', async () => {
    const events = [
      {
        eventId: 'evt_exam',
        summary: '体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_court',
        summary: '开庭',
        startTime: new Date('2026-07-18T14:00:00+08:00'),
        endTime: new Date('2026-07-18T15:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, actions } = setup(
      [
        { action: 'cancel', title: '体检', date: '17号', start_time: '' },
        { action: 'cancel', title: '开庭', date: '18号', start_time: '' },
      ],
      events,
    );
    await service.handleText(
      { ...input, text: '删除17号体检；18号开庭' },
      reference,
    );
    expect(actions.promptMutation).toHaveBeenCalledTimes(2);
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'cancel', eventId: 'evt_exam' }),
    );
    expect(actions.promptMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'cancel', eventId: 'evt_court' }),
    );
  });

  it('回复多个序号时为所选日程分别生成删除确认卡', async () => {
    const events = [
      {
        eventId: 'evt_1',
        summary: '上午体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_2',
        summary: '下午体检',
        startTime: new Date('2026-07-17T15:00:00+08:00'),
        endTime: new Date('2026-07-17T16:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, actions, store } = setup({}, events);
    await service.selectCancellations(
      { ...input, parentId: 'om_candidates', text: '1、2' },
      {
        kind: 'calendar_cancel_selection',
        candidates: events.map((event) => ({
          eventId: event.eventId,
          summary: event.summary,
          startTime: event.startTime.toISOString(),
          endTime: event.endTime.toISOString(),
        })),
        expiresAt: '2026-07-16T00:00:00.000Z',
      },
    );
    expect(actions.promptMutation).toHaveBeenCalledTimes(2);
    expect(store.completePending).toHaveBeenCalledWith(
      'om_candidates',
      'success',
      expect.stringContaining('selected:2'),
    );
  });

  it('独立发送空格分隔序号时关联最近的删除候选清单', async () => {
    const events = [
      {
        eventId: 'evt_1',
        summary: '上午体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_2',
        summary: '下午体检',
        startTime: new Date('2026-07-17T15:00:00+08:00'),
        endTime: new Date('2026-07-17T16:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, actions, store } = setup({}, events);
    const action = {
      kind: 'calendar_cancel_selection' as const,
      candidates: events.map((event) => ({
        eventId: event.eventId,
        summary: event.summary,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
      })),
      expiresAt: '2026-07-16T00:00:00.000Z',
    };
    store.getLatestPendingCancellationSelection.mockResolvedValue({
      replyMessageId: 'om_candidates',
      action,
    });

    await service.handleText(
      { ...input, parentId: null, text: '1 2' },
      reference,
    );

    expect(actions.promptMutation).toHaveBeenCalledTimes(2);
    expect(store.completePending).toHaveBeenCalledWith(
      'om_candidates',
      'success',
      expect.stringContaining('selected:2'),
    );
  });

  it('独立发送序号但没有有效候选清单时给出明确反馈', async () => {
    const { service, feishu, store } = setup({});
    store.getLatestPendingCancellationSelection.mockResolvedValue(null);

    await service.handleText(
      { ...input, parentId: null, text: '1、2、3' },
      reference,
    );

    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('没有找到仍有效的删除候选清单'),
      expect.any(String),
    );
  });

  it('删除某日全部日程时把通用标题视为无标题筛选', async () => {
    const events = [
      {
        eventId: 'evt_1',
        summary: '体检',
        startTime: new Date('2026-07-17T07:00:00+08:00'),
        endTime: new Date('2026-07-17T08:00:00+08:00'),
        allDay: false,
      },
      {
        eventId: 'evt_2',
        summary: '开会',
        startTime: new Date('2026-07-17T15:00:00+08:00'),
        endTime: new Date('2026-07-17T16:00:00+08:00'),
        allDay: false,
      },
    ];
    const { service, store } = setup(
      {
        action: 'cancel',
        title: '全部日程',
        date: '17号',
        start_time: '',
      },
      events,
    );
    await service.handleText({ ...input, text: '删除17号全部日程' }, reference);
    expect(store.savePending).toHaveBeenCalledWith(
      'om_reply',
      expect.objectContaining({
        kind: 'calendar_cancel_selection',
        candidates: expect.arrayContaining([
          expect.objectContaining({ eventId: 'evt_1' }),
          expect.objectContaining({ eventId: 'evt_2' }),
        ]),
      }),
    );
  });

  it('只有日期没有事项时回复具体原因且不创建', async () => {
    const { service, feishu } = setup({
      action: 'create',
      title: '',
      date: '17号',
      start_time: '',
    });
    await service.handleText({ ...input, text: '17号' }, reference);
    expect(feishu.createCalendarEvent).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_text',
      expect.stringContaining('缺少事项信息'),
      expect.any(String),
    );
  });
});
