import {
  dashboardHealthFromLog,
  dashboardOverall,
  eventIdToUuid,
  extractScheduleRequest,
  getMissingScheduleFields,
  isPendingOperationActive,
  RobotService,
} from './robot.service';

describe('robot message helpers', () => {
  const eventBody = {
    header: {
      event_id: 'evt_1',
      event_type: 'im.message.receive_v1',
    },
    event: {
      message: {
        message_id: 'om_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({
          text: '@_user_1 明天下午3点合同评审会一小时',
        }),
        mentions: [
          {
            key: '@_user_1',
            id: { open_id: 'ou_bot' },
            name: '日程机器人',
          },
        ],
      },
    },
  };

  it('状态面板只统计尚未过期的待处理操作', () => {
    const now = new Date('2026-07-15T08:00:00.000Z');
    expect(
      isPendingOperationActive(
        JSON.stringify({ expiresAt: '2026-07-15T08:01:00.000Z' }),
        now,
      ),
    ).toBe(true);
    expect(
      isPendingOperationActive(
        JSON.stringify({ expiresAt: '2026-07-15T07:59:00.000Z' }),
        now,
      ),
    ).toBe(false);
    expect(isPendingOperationActive('{}', now)).toBe(false);
  });

  it('没有运行记录时显示尚无数据，不伪报正常或异常', () => {
    const item = dashboardHealthFromLog(
      'message',
      '消息监听',
      undefined,
      '等待首次消息',
      (value) => value,
    );
    expect(item).toEqual({
      key: 'message',
      label: '消息监听',
      status: 'unknown',
      desc: '等待首次消息',
      lastAt: null,
    });
    expect(dashboardOverall([item])).toBe('unknown');
  });

  it('任一状态异常时总状态优先显示需要关注', () => {
    expect(
      dashboardOverall([
        {
          key: 'message',
          label: '消息监听',
          status: 'unknown',
          desc: '等待首次消息',
          lastAt: null,
        },
        {
          key: 'calendar',
          label: '日历读写',
          status: 'abnormal',
          desc: '无权限',
          lastAt: null,
        },
      ]),
    ).toBe('attention');
  });

  it('只处理 mentions 中命中 BOT_OPEN_ID 的文本', () => {
    expect(
      extractScheduleRequest(eventBody, 'ou_bot', '日程机器人'),
    ).toEqual({
      eventId: 'om_1',
      text: '明天下午3点合同评审会一小时',
    });
  });

  it('机器人 open_id 未配置时可按机器人名称识别', () => {
    expect(extractScheduleRequest(eventBody, '', '日程机器人')).toEqual({
      eventId: 'om_1',
      text: '明天下午3点合同评审会一小时',
    });
  });

  it('没有 @目标机器人时返回 null', () => {
    expect(
      extractScheduleRequest(eventBody, 'ou_other', '其他机器人'),
    ).toBeNull();
  });

  it('忽略非群聊和非文本事件', () => {
    const directMessage = structuredClone(eventBody);
    directMessage.event.message.chat_type = 'p2p';
    expect(
      extractScheduleRequest(directMessage, 'ou_bot', '日程机器人'),
    ).toBeNull();

    const imageMessage = structuredClone(eventBody);
    imageMessage.event.message.message_type = 'image';
    expect(
      extractScheduleRequest(imageMessage, 'ou_bot', '日程机器人'),
    ).toBeNull();
  });

  it('把同一事件 ID 稳定映射为同一个 UUID', () => {
    const first = eventIdToUuid('evt_1');
    const second = eventIdToUuid('evt_1');

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(eventIdToUuid('evt_2')).not.toBe(first);
  });

  it('只把事项视为必填，日期和时间均可使用默认值', () => {
    expect(
      getMissingScheduleFields({
        title: '',
        date: '',
        time: '',
        duration_minutes: 0,
      }),
    ).toEqual(['事项']);
  });
});

describe('RobotService 事件分流', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CHAT_ID: 'oc_target',
      TARGET_OPEN_ID: 'ou_owner',
      BOT_OPEN_ID: 'ou_bot',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('目标用户 @文字只处理一次并委派文字服务', async () => {
    const calendar = { handleText: jest.fn().mockResolvedValue(undefined) };
    const store = {
      claimMessage: jest.fn().mockResolvedValue(true),
      completeMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      {} as never,
      calendar as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 17号上午体检' }),
          mentions: [
            { key: '@_u', name: '日程机器人', id: { open_id: 'ou_bot' } },
          ],
        },
      },
    };
    await expect(service.handleFeishuEvent(body)).resolves.toEqual({
      code: 0,
      msg: 'ok',
    });
    expect(calendar.handleText).toHaveBeenCalledTimes(1);
    expect(store.completeMessage).toHaveBeenCalledWith(
      'om_1',
      'success',
      'handled',
    );
  });

  it('回复候选消息中的多个序号时委派批量删除选择服务', async () => {
    const pending = {
      kind: 'calendar_cancel_selection' as const,
      candidates: [
        {
          eventId: 'evt_1',
          summary: '体检',
          startTime: '2026-07-17T00:00:00.000Z',
          endTime: '2026-07-17T01:00:00.000Z',
        },
      ],
      expiresAt: '2026-07-16T00:00:00.000Z',
    };
    const calendar = {
      handleText: jest.fn(),
      selectCancellations: jest.fn().mockResolvedValue(undefined),
    };
    const store = {
      claimMessage: jest.fn().mockResolvedValue(true),
      getPending: jest
        .fn()
        .mockResolvedValue({ state: 'pending', action: pending }),
      completeMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      {} as never,
      calendar as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_select',
          parent_id: 'om_candidates',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 1' }),
          mentions: [
            { key: '@_u', name: '日程机器人', id: { open_id: 'ou_bot' } },
          ],
        },
      },
    };
    await service.handleFeishuEvent(body);
    expect(calendar.selectCancellations).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'om_select',
        parentId: 'om_candidates',
        text: '1',
      }),
      pending,
    );
    expect(calendar.handleText).not.toHaveBeenCalled();
  });

  it('回复修改候选消息时委派单个日程选择服务', async () => {
    const pending = {
      kind: 'calendar_update_selection' as const,
      request: {
        sourceText: '月婷吃饭改周三',
        command: {},
        raw: {},
        referenceTime: '2026-07-19T01:00:00.000Z',
      },
      candidates: [
        {
          eventId: 'evt_1',
          summary: '和月婷吃饭',
          startTime: '2026-07-21T11:00:00.000Z',
          endTime: '2026-07-21T12:00:00.000Z',
        },
      ],
      expiresAt: '2026-07-20T01:00:00.000Z',
    };
    const calendar = {
      handleText: jest.fn(),
      selectUpdateCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const store = {
      claimMessage: jest.fn().mockResolvedValue(true),
      getPending: jest
        .fn()
        .mockResolvedValue({ state: 'pending', action: pending }),
      completeMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      {} as never,
      calendar as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_update_select',
          parent_id: 'om_update_candidates',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 1' }),
          mentions: [
            { key: '@_u', name: '日程机器人', id: { open_id: 'ou_bot' } },
          ],
        },
      },
    };

    await service.handleFeishuEvent(body);

    expect(calendar.selectUpdateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'om_update_select',
        parentId: 'om_update_candidates',
        text: '1',
      }),
      pending,
    );
    expect(calendar.handleText).not.toHaveBeenCalled();
  });

  it('消息登记失败时也回复明确错误且不再抛出 500', async () => {
    const feishu = {
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const store = {
      claimMessage: jest
        .fn()
        .mockRejectedValue(new Error('database unavailable')),
      completeMessage: jest.fn(),
    };
    const service = new RobotService(
      {} as never,
      feishu as never,
      {} as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_claim_error',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 明天上午体检' }),
          mentions: [
            { key: '@_u', name: '日程机器人', id: { open_id: 'ou_bot' } },
          ],
        },
      },
    };

    await expect(service.handleFeishuEvent(body)).resolves.toEqual({
      code: 0,
      msg: 'handled with feedback',
    });
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_claim_error',
      expect.stringContaining('database unavailable'),
      expect.any(String),
    );
  });

  it('数据库查询失败时不向群内暴露 SQL 和参数', async () => {
    const feishu = {
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const calendar = {
      handleText: jest
        .fn()
        .mockRejectedValue(
          new Error('Failed query: insert into operation_log params: private'),
        ),
    };
    const store = {
      claimMessage: jest.fn().mockResolvedValue(true),
      completeMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      feishu as never,
      calendar as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_query_error',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 明天上午体检' }),
          mentions: [
            {
              key: '@_u',
              name: '日程机器人',
              id: { open_id: 'ou_bot' },
            },
          ],
        },
      },
    };

    await service.handleFeishuEvent(body);

    const reply = feishu.replyTextMessage.mock.calls[0][1] as string;
    expect(reply).toContain('指令内容已识别，但系统暂时无法保存确认操作');
    expect(reply).toContain('飞书日历未发生变更');
    expect(reply).not.toContain('insert into');
    expect(reply).not.toContain('params:');
  });

  it('输入解析错误保留具体原因而不误报数据库故障', async () => {
    const feishu = {
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const calendar = {
      handleText: jest
        .fn()
        .mockRejectedValue(new Error('日期格式无法识别，请保留“时间”字段')),
    };
    const store = {
      claimMessage: jest.fn().mockResolvedValue(true),
      completeMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      feishu as never,
      calendar as never,
      {} as never,
      store as never,
      {} as never,
    );
    const body = {
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_id: { open_id: 'ou_owner' } },
        message: {
          message_id: 'om_parse_error',
          chat_id: 'oc_target',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '@_u 时间大概下周' }),
          mentions: [
            {
              key: '@_u',
              name: '日程机器人',
              id: { open_id: 'ou_bot' },
            },
          ],
        },
      },
    };

    await service.handleFeishuEvent(body);

    const reply = feishu.replyTextMessage.mock.calls[0][1] as string;
    expect(reply).toContain('日期格式无法识别');
    expect(reply).not.toContain('系统暂时无法保存确认操作');
  });

  it('目标用户的卡片按钮只处理一次并委派卡片服务', async () => {
    const cardActions = {
      handleCardAction: jest.fn().mockResolvedValue(undefined),
    };
    const store = {
      claimCardCallback: jest.fn().mockResolvedValue(true),
      completeCardCallback: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      store as never,
      cardActions as never,
    );
    const body = {
      header: { event_type: 'card.action.trigger', event_id: 'evt_callback' },
      event: {
        operator: { open_id: 'ou_owner' },
        context: { open_chat_id: 'oc_target', open_message_id: 'om_card' },
        action: { value: { actionId: 'act-1', decision: 'confirm' } },
      },
    };
    await service.handleFeishuCardAction(body);
    expect(cardActions.handleCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'act-1' }),
    );
    expect(store.completeCardCallback).toHaveBeenCalledWith(
      'evt_callback',
      'success',
      'confirm',
    );
  });

  it('继续查两年按钮委派给日程命令服务', async () => {
    const calendar = {
      handleSearchExpansionAction: jest.fn().mockResolvedValue(undefined),
    };
    const cardActions = { handleCardAction: jest.fn() };
    const store = {
      claimCardCallback: jest.fn().mockResolvedValue(true),
      completeCardCallback: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      {} as never,
      calendar as never,
      {} as never,
      store as never,
      cardActions as never,
    );
    const body = {
      header: {
        event_type: 'card.action.trigger',
        event_id: 'evt_search_callback',
      },
      event: {
        operator: { open_id: 'ou_owner' },
        context: {
          open_chat_id: 'oc_target',
          open_message_id: 'om_search_card',
        },
        action: {
          value: { actionId: 'act-search', decision: 'search_two_years' },
        },
      },
    };

    await service.handleFeishuCardAction(body);

    expect(calendar.handleSearchExpansionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'act-search',
        decision: 'search_two_years',
      }),
    );
    expect(cardActions.handleCardAction).not.toHaveBeenCalled();
    expect(store.completeCardCallback).toHaveBeenCalledWith(
      'evt_search_callback',
      'success',
      'search_two_years',
    );
  });

  it('卡片回调记录无法保存时明确反馈未修改日历', async () => {
    const feishu = {
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const cardActions = {
      handleCardAction: jest.fn().mockResolvedValue(undefined),
    };
    const store = {
      claimCardCallback: jest.fn().mockRejectedValue(new Error('db down')),
      completeCardCallback: jest.fn(),
    };
    const service = new RobotService(
      {} as never,
      feishu as never,
      {} as never,
      {} as never,
      store as never,
      cardActions as never,
    );
    const body = {
      header: {
        event_type: 'card.action.trigger',
        event_id: 'evt_callback_fail',
      },
      event: {
        operator: { open_id: 'ou_owner' },
        context: { open_chat_id: 'oc_target', open_message_id: 'om_card' },
        action: { value: { actionId: 'act-1', decision: 'confirm' } },
      },
    };

    await service.handleFeishuCardAction(body);

    expect(cardActions.handleCardAction).not.toHaveBeenCalled();
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_card',
      expect.stringContaining('飞书日历未发生变更'),
      expect.any(String),
    );
  });

  it('卡片执行途中失败时提示先核对日历实际结果', async () => {
    const feishu = {
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const cardActions = {
      handleCardAction: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const store = {
      claimCardCallback: jest.fn().mockResolvedValue(true),
      completeCardCallback: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RobotService(
      {} as never,
      feishu as never,
      {} as never,
      {} as never,
      store as never,
      cardActions as never,
    );
    const body = {
      header: {
        event_type: 'card.action.trigger',
        event_id: 'evt_action_fail',
      },
      event: {
        operator: { open_id: 'ou_owner' },
        context: { open_chat_id: 'oc_target', open_message_id: 'om_card' },
        action: { value: { actionId: 'act-1', decision: 'confirm' } },
      },
    };

    await service.handleFeishuCardAction(body);

    expect(store.completeCardCallback).toHaveBeenCalledWith(
      'evt_action_fail',
      'fail',
      'failed',
      'timeout',
    );
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_card',
      expect.stringContaining('请先查看日历中的实际结果'),
      expect.any(String),
    );
  });
});
