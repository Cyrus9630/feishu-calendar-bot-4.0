import { CalendarActionService } from './calendar-action.service';
import { EVENT_COLORS } from './schedule-command';
import type {
  CalendarMutationPending,
  CalendarUndoPending,
} from './calendar-action.types';

const snapshot = {
  summary: '客户会议',
  startTime: '2026-07-18T06:00:00.000Z',
  endTime: '2026-07-18T07:00:00.000Z',
  color: EVENT_COLORS.红色,
  colorName: '红色' as const,
  reminders: [30],
};

describe('CalendarActionService', () => {
  const originalEnv = process.env;
  let feishu: Record<string, jest.Mock>;
  let store: Record<string, jest.Mock>;
  let service: CalendarActionService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TARGET_OPEN_ID: 'ou_owner',
      CHAT_ID: 'oc_chat',
    };
    feishu = {
      replyInteractiveCard: jest.fn().mockResolvedValue('om_card'),
      updateInteractiveCard: jest.fn().mockResolvedValue(undefined),
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
      createCalendarEvent: jest.fn().mockResolvedValue('evt_created'),
      patchCalendarEvent: jest.fn().mockResolvedValue(undefined),
      deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
      listCalendarEvents: jest.fn().mockResolvedValue([]),
      getCalendarEvent: jest.fn(),
    };
    store = {
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      saveCalendarCardReference: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      completePending: jest.fn().mockResolvedValue(undefined),
      completeCardAction: jest.fn().mockResolvedValue(undefined),
      getCardAction: jest.fn(),
      claimCardAction: jest.fn(),
      recordCreatedEvent: jest.fn().mockResolvedValue(undefined),
    };
    service = new CalendarActionService(feishu as never, store as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('红色事项只保存待确认状态并发送卡片', async () => {
    await service.promptMutation(
      { messageId: 'om_source' },
      { operation: 'create', after: snapshot, red: true, conflicts: [] },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.createCalendarEvent).not.toHaveBeenCalled();
    expect(store.saveCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ red: true, operation: 'create' }),
    );
    const card = feishu.replyInteractiveCard.mock.calls[0][1];
    expect(JSON.stringify(card)).toContain('确认创建');
  });

  it('普通无冲突事项直接创建并返回十分钟撤销按钮', async () => {
    feishu.replyInteractiveCard.mockResolvedValue('om_success');
    await service.executeDirect(
      { messageId: 'om_source' },
      {
        operation: 'create',
        after: { ...snapshot, color: EVENT_COLORS.蓝色, colorName: '蓝色' },
        red: false,
        conflicts: [],
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(store.saveCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'calendar_undo' }),
    );
    expect(
      JSON.stringify(feishu.replyInteractiveCard.mock.calls[0][1]),
    ).toContain('撤销本次操作');
    expect(store.saveCalendarCardReference).toHaveBeenCalledWith('om_success', {
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      eventIds: ['evt_created'],
    });
  });

  it('确认执行成功后把原地更新的卡片绑定到日程', async () => {
    const pending: CalendarMutationPending = {
      kind: 'calendar_mutation',
      actionId: 'act-create',
      operation: 'create',
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_success',
      after: snapshot,
      red: true,
      conflictIds: [],
      restorable: true,
      expiresAt: '2026-07-20T00:00:00.000Z',
    };
    store.getCardAction.mockResolvedValue(pending);
    store.claimCardAction.mockResolvedValue({
      state: 'claimed',
      action: pending,
    });

    await service.handleCardAction({
      kind: 'card_action',
      callbackId: 'cb-create',
      messageId: 'om_success',
      chatId: 'oc_target',
      operatorOpenId: 'ou_owner',
      actionId: 'act-create',
      decision: 'confirm',
    });

    expect(store.saveCalendarCardReference).toHaveBeenCalledWith('om_success', {
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      eventIds: ['evt_created'],
    });
  });

  it('引用映射保存失败时不误报日历写入失败', async () => {
    store.saveCalendarCardReference.mockRejectedValue(
      new Error('reference unavailable'),
    );

    await expect(
      service.executeDirect(
        { messageId: 'om_source' },
        {
          operation: 'create',
          after: { ...snapshot, color: EVENT_COLORS.蓝色, colorName: '蓝色' },
          red: false,
          conflicts: [],
        },
        new Date('2026-07-15T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();

    expect(feishu.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_card',
      expect.stringContaining('日历已更新，但卡片引用暂不可用'),
      expect.any(String),
    );
  });

  it('创建重复日程时把 RRULE 传给飞书并在卡片显示中文周期', async () => {
    await service.executeDirect(
      { messageId: 'om_source' },
      {
        operation: 'create',
        after: {
          ...snapshot,
          recurrence: 'FREQ=MONTHLY;INTERVAL=3',
          recurrenceText: '每3个月',
        },
        red: false,
        conflicts: [],
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

    expect(feishu.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: 'FREQ=MONTHLY;INTERVAL=3' }),
      expect.any(String),
    );
    expect(
      JSON.stringify(feishu.replyInteractiveCard.mock.calls[0][1]),
    ).toContain('每3个月');
  });

  it('从飞书记录生成快照时保留重复规则', () => {
    expect(
      service.snapshot({
        eventId: 'evt_recurring',
        summary: '交房租',
        startTime: new Date(snapshot.startTime),
        endTime: new Date(snapshot.endTime),
        color: EVENT_COLORS.蓝色,
        reminders: [30],
        recurrence: 'FREQ=MONTHLY;INTERVAL=3',
        allDay: false,
        attendeeCount: 0,
        hasMeeting: false,
      }),
    ).toEqual(
      expect.objectContaining({ recurrence: 'FREQ=MONTHLY;INTERVAL=3' }),
    );
  });

  it('日历已创建但结果卡失败时用文字反馈真实结果', async () => {
    feishu.replyInteractiveCard.mockRejectedValue(
      new Error('card unavailable'),
    );
    await service.executeDirect(
      { messageId: 'om_source' },
      {
        operation: 'create',
        after: { ...snapshot, color: EVENT_COLORS.蓝色, colorName: '蓝色' },
        red: false,
        conflicts: [],
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(feishu.replyTextMessage).toHaveBeenCalledWith(
      'om_source',
      expect.stringContaining('日程创建成功'),
      expect.any(String),
    );
  });

  it('日历已创建后卡片和文字反馈均失败时不向上误报创建失败', async () => {
    feishu.replyInteractiveCard.mockRejectedValue(
      new Error('card unavailable'),
    );
    feishu.replyTextMessage.mockRejectedValue(new Error('message unavailable'));
    await expect(
      service.executeDirect(
        { messageId: 'om_source' },
        {
          operation: 'create',
          after: { ...snapshot, color: EVENT_COLORS.蓝色, colorName: '蓝色' },
          red: false,
          conflicts: [],
        },
        new Date('2026-07-15T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
    expect(feishu.createCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it('操作记录保存失败时仍反馈日历创建成功', async () => {
    store.recordCreatedEvent.mockRejectedValue(new Error('db unavailable'));
    await service.executeDirect(
      { messageId: 'om_source' },
      {
        operation: 'create',
        after: { ...snapshot, color: EVENT_COLORS.蓝色, colorName: '蓝色' },
        red: false,
        conflicts: [],
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(feishu.replyInteractiveCard).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(feishu.replyInteractiveCard.mock.calls[0][1]),
    ).toContain('日程创建成功');
  });

  it('日历已修改但成功状态保存失败时不误报未变更', async () => {
    const before = { ...snapshot, eventId: 'evt_update' };
    const after = { ...before, summary: '客户会议（修改）' };
    const pending: CalendarMutationPending = {
      kind: 'calendar_mutation',
      actionId: 'act-update',
      operation: 'update',
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_card',
      eventId: 'evt_update',
      before,
      after,
      red: true,
      conflictIds: [],
      restorable: true,
      expiresAt: '2026-07-16T00:00:00.000Z',
    };
    store.getCardAction.mockResolvedValue(pending);
    store.claimCardAction.mockResolvedValue({
      state: 'claimed',
      action: pending,
    });
    store.completeCardAction.mockRejectedValue(new Error('db down'));
    feishu.getCalendarEvent.mockResolvedValue({
      eventId: 'evt_update',
      summary: before.summary,
      startTime: new Date(before.startTime),
      endTime: new Date(before.endTime),
      color: before.color,
      reminders: before.reminders,
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    });

    await service.handleCardAction({
      kind: 'card_action',
      callbackId: 'cb-update',
      messageId: 'om_card',
      chatId: 'oc_chat',
      operatorOpenId: 'ou_owner',
      actionId: 'act-update',
      decision: 'confirm',
    });

    expect(feishu.patchCalendarEvent).toHaveBeenCalled();
    const terminalCards = feishu.updateInteractiveCard.mock.calls.map((call) =>
      JSON.stringify(call[1]),
    );
    expect(terminalCards.join('\n')).toContain('日程操作成功');
    expect(terminalCards.join('\n')).not.toContain('飞书日历未按本次操作变更');
  });

  it('修改本次及后续时先截断原系列再创建新系列', async () => {
    const master = {
      ...snapshot,
      eventId: 'rent_0',
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
      recurrenceText: '每3个月',
    };
    feishu.getCalendarEvent.mockResolvedValue({
      ...master,
      startTime: new Date(master.startTime),
      endTime: new Date(master.endTime),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    });
    await service.executeDirect(
      { messageId: 'om_source' },
      {
        operation: 'update_future',
        eventId: 'rent_0',
        before: master,
        after: {
          ...master,
          eventId: undefined,
          startTime: '2026-10-18T07:00:00.000Z',
          endTime: '2026-10-18T08:00:00.000Z',
        },
        truncatedRecurrence: 'FREQ=MONTHLY;INTERVAL=3;UNTIL=20261018T055959Z',
        red: false,
        conflicts: [],
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.patchCalendarEvent).toHaveBeenNthCalledWith(1, 'rent_0', {
      recurrence: 'FREQ=MONTHLY;INTERVAL=3;UNTIL=20261018T055959Z',
    });
    expect(feishu.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: 'FREQ=MONTHLY;INTERVAL=3' }),
      expect.any(String),
    );
  });

  it('创建新系列失败时恢复原重复规则', async () => {
    const master = {
      ...snapshot,
      eventId: 'rent_0',
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
      recurrenceText: '每3个月',
    };
    feishu.getCalendarEvent.mockResolvedValue({
      ...master,
      startTime: new Date(master.startTime),
      endTime: new Date(master.endTime),
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    });
    feishu.createCalendarEvent.mockRejectedValue(new Error('create failed'));
    await expect(
      service.executeDirect(
        { messageId: 'om_source' },
        {
          operation: 'update_future',
          eventId: 'rent_0',
          before: master,
          after: {
            ...master,
            eventId: undefined,
            startTime: '2026-10-18T07:00:00.000Z',
            endTime: '2026-10-18T08:00:00.000Z',
          },
          truncatedRecurrence: 'FREQ=MONTHLY;INTERVAL=3;UNTIL=20261018T055959Z',
          red: false,
          conflicts: [],
        },
      ),
    ).rejects.toThrow('create failed');
    expect(feishu.patchCalendarEvent).toHaveBeenLastCalledWith('rent_0', {
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
    });
  });

  it('确认时发现新的冲突则不创建并刷新卡片', async () => {
    const pending: CalendarMutationPending = {
      kind: 'calendar_mutation',
      actionId: 'act-1',
      operation: 'create',
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_card',
      after: snapshot,
      red: true,
      conflictIds: [],
      restorable: true,
      expiresAt: '2026-07-16T00:00:00.000Z',
    };
    store.getCardAction.mockResolvedValue(pending);
    store.claimCardAction.mockResolvedValue({
      state: 'claimed',
      action: pending,
    });
    feishu.listCalendarEvents.mockResolvedValue([
      {
        eventId: 'evt_conflict',
        summary: '已有会议',
        startTime: new Date(snapshot.startTime),
        endTime: new Date(snapshot.endTime),
      },
    ]);
    await service.handleCardAction(
      {
        kind: 'card_action',
        callbackId: 'cb',
        messageId: 'om_card',
        chatId: 'oc_chat',
        operatorOpenId: 'ou_owner',
        actionId: 'act-1',
        decision: 'confirm',
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(feishu.createCalendarEvent).not.toHaveBeenCalled();
    expect(feishu.updateInteractiveCard).toHaveBeenCalled();
    expect(store.saveCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ conflictIds: ['evt_conflict'] }),
    );
  });

  it('创建撤销前校验当前快照并删除日程', async () => {
    const undo: CalendarUndoPending = {
      kind: 'calendar_undo',
      actionId: 'undo-1',
      operation: 'create',
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_card',
      eventId: 'evt_created',
      after: { ...snapshot, eventId: 'evt_created' },
      expiresAt: '2026-07-15T00:10:00.000Z',
    };
    store.getCardAction.mockResolvedValue(undo);
    store.claimCardAction.mockResolvedValue({ state: 'claimed', action: undo });
    feishu.getCalendarEvent.mockResolvedValue({
      eventId: 'evt_created',
      summary: snapshot.summary,
      startTime: new Date(snapshot.startTime),
      endTime: new Date(snapshot.endTime),
      color: snapshot.color,
      reminders: [30],
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    });
    await service.handleCardAction(
      {
        kind: 'card_action',
        callbackId: 'cb',
        messageId: 'om_card',
        chatId: 'oc_chat',
        operatorOpenId: 'ou_owner',
        actionId: 'undo-1',
        decision: 'undo',
      },
      new Date('2026-07-15T00:05:00.000Z'),
    );
    expect(feishu.deleteCalendarEvent).toHaveBeenCalledWith('evt_created');
    expect(store.completeCardAction).toHaveBeenCalledWith(
      'undo-1',
      'success',
      'undone',
    );
  });

  it('撤销机器人创建的重复日程时删除整个重复系列', async () => {
    const recurring = {
      ...snapshot,
      eventId: 'evt_recurring_0',
      recurrence: 'FREQ=YEARLY;INTERVAL=1',
      recurrenceText: '每年7月18日',
    };
    const undo: CalendarUndoPending = {
      kind: 'calendar_undo',
      actionId: 'undo-recurring',
      operation: 'create',
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      sourceMessageId: 'om_source',
      cardMessageId: 'om_card',
      eventId: 'evt_recurring_0',
      after: recurring,
      expiresAt: '2026-07-15T00:10:00.000Z',
    };
    store.getCardAction.mockResolvedValue(undo);
    store.claimCardAction.mockResolvedValue({ state: 'claimed', action: undo });
    feishu.getCalendarEvent.mockResolvedValue({
      eventId: 'evt_recurring_0',
      summary: snapshot.summary,
      startTime: new Date(snapshot.startTime),
      endTime: new Date(snapshot.endTime),
      color: snapshot.color,
      reminders: [30],
      recurrence: 'FREQ=YEARLY;INTERVAL=1',
      allDay: false,
      attendeeCount: 0,
      hasMeeting: false,
    });

    await service.handleCardAction(
      {
        kind: 'card_action',
        callbackId: 'cb-recurring',
        messageId: 'om_card',
        chatId: 'oc_chat',
        operatorOpenId: 'ou_owner',
        actionId: 'undo-recurring',
        decision: 'undo',
      },
      new Date('2026-07-15T00:05:00.000Z'),
    );

    expect(feishu.deleteCalendarEvent).toHaveBeenCalledWith('evt_recurring_0');
  });
});
