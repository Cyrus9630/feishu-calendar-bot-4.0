import { OperationStoreService, stableUuid } from './operation-store.service';

describe('OperationStoreService', () => {
  it('把相同输入稳定映射为 UUID', () => {
    expect(stableUuid('message:om_1')).toBe(stableUuid('message:om_1'));
    expect(stableUuid('message:om_1')).not.toBe(stableUuid('message:om_2'));
    expect(stableUuid('message:om_1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('同一消息只有第一次能够取得处理权', async () => {
    const returning = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'uuid' }])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));
    const service = new OperationStoreService({ insert } as never);

    await expect(service.claimMessage('om_1', 'text')).resolves.toBe(true);
    await expect(service.claimMessage('om_1', 'text')).resolves.toBe(false);
  });

  it('过期确认记录返回 missing 并标记失败', async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        status: 'processing',
        result: JSON.stringify({
          kind: 'calendar_cancel',
          eventId: 'evt_1',
          summary: '体检',
          timeText: '2026-07-17 07:00',
          expiresAt: '2026-07-15T00:00:00.000Z',
        }),
      },
    ]);
    const whereSelect = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where: whereSelect }));
    const select = jest.fn(() => ({ from }));
    const whereUpdate = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn(() => ({ where: whereUpdate }));
    const update = jest.fn(() => ({ set }));
    const service = new OperationStoreService({ select, update } as never);

    await expect(
      service.getPending('om_reply', new Date('2026-07-16T00:00:00.000Z')),
    ).resolves.toEqual({ state: 'missing' });
    expect(update).toHaveBeenCalled();
  });

  it('候选待处理记录只能被原子领取一次', async () => {
    const action = {
      kind: 'calendar_update_selection',
      request: {
        sourceText: '月婷吃饭改周三',
        command: {},
        raw: {},
        referenceTime: '2026-07-19T01:00:00.000Z',
      },
      candidates: [],
      expiresAt: '2026-07-20T01:00:00.000Z',
    };
    const returning = jest
      .fn()
      .mockResolvedValueOnce([{ result: JSON.stringify(action) }])
      .mockResolvedValueOnce([]);
    const whereUpdate = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where: whereUpdate }));
    const update = jest.fn(() => ({ set }));
    const limit = jest.fn().mockResolvedValue([
      { status: 'claimed', result: JSON.stringify(action) },
    ]);
    const whereSelect = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where: whereSelect }));
    const select = jest.fn(() => ({ from }));
    const service = new OperationStoreService({ update, select } as never);
    const now = new Date('2026-07-19T02:00:00.000Z');

    await expect(service.claimPending('om_candidates', now)).resolves.toEqual({
      state: 'claimed',
      action,
    });
    await expect(service.claimPending('om_candidates', now)).resolves.toEqual({
      state: 'completed',
    });
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it('保存卡片操作时只在服务端结果中保留完整快照', async () => {
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));
    const service = new OperationStoreService({ insert } as never);

    await service.saveCardAction({
      kind: 'calendar_mutation',
      actionId: 'act-1',
      operation: 'create',
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      sourceMessageId: 'om_source',
      after: {
        summary: '开会',
        startTime: '2026-07-18T06:00:00.000Z',
        endTime: '2026-07-18T07:00:00.000Z',
        color: 0xf54a45,
        colorName: '红色',
        reminders: [30],
      },
      red: true,
      conflictIds: [],
      restorable: true,
      expiresAt: '2026-07-16T00:00:00.000Z',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'calendar_action',
        status: 'processing',
        content: 'om_source',
        result: expect.stringContaining('ou_owner'),
      }),
    );
  });

  it('把两年扩展搜索动作保存为既有的 calendar_action 类型', async () => {
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const service = new OperationStoreService({
      insert: () => ({ values }),
    } as never);

    await service.saveCardAction({
      kind: 'calendar_search_expansion',
      actionId: 'act-search',
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      sourceMessageId: 'om_source',
      request: {
        sourceText: '月婷吃饭改周三',
        command: {
          action: 'update',
          title: '月婷吃饭',
          dateText: '',
          startText: '',
          endText: '',
          durationMinutes: 60,
          color: { name: '黄色', rgb: 0xffc60a },
          colorExplicit: false,
          location: '',
          reminderMinutes: [],
        },
        raw: {
          action: 'update',
          title: '月婷吃饭',
          date: '',
          duration_minutes: 0,
        },
        referenceTime: '2026-07-19T01:00:00.000Z',
      },
      expiresAt: '2026-07-20T01:00:00.000Z',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'calendar_action' }),
    );
  });

  it('保存卡片操作遇到瞬时数据库错误时自动重试', async () => {
    const onConflictDoNothing = jest
      .fn()
      .mockRejectedValueOnce(new Error('Failed query: connection reset'))
      .mockResolvedValueOnce(undefined);
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));
    const service = new OperationStoreService({ insert } as never);

    await expect(
      service.saveCardAction({
        kind: 'calendar_mutation',
        actionId: 'act-retry',
        operation: 'create',
        actorOpenId: 'ou_owner',
        chatId: 'oc_target',
        sourceMessageId: 'om_source',
        after: {
          summary: '开庭',
          startTime: '2026-07-23T01:30:00.000Z',
          endTime: '2026-07-23T03:30:00.000Z',
          color: 0xf54a45,
          colorName: '红色',
          reminders: [1440, 120],
        },
        red: true,
        conflictIds: [],
        restorable: true,
        expiresAt: '2026-07-16T00:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it('幂等保存卡片与去重后的日程引用', async () => {
    let insertedValue: Record<string, unknown> = {};
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn((value: Record<string, unknown>) => {
      insertedValue = value;
      return { onConflictDoUpdate };
    });
    const insert = jest.fn(() => ({ values }));
    const service = new OperationStoreService({ insert } as never);

    await service.saveCalendarCardReference('om_card', {
      actorOpenId: 'ou_owner',
      chatId: 'oc_target',
      eventIds: ['evt_1', 'evt_2', 'evt_1'],
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'calendar_card_reference',
        content: 'om_card',
        status: 'success',
        result: expect.stringContaining('evt_1'),
      }),
    );
    expect(JSON.parse(String(insertedValue.result)).eventIds).toEqual([
      'evt_1',
      'evt_2',
    ]);
  });

  it('优先读取稳定卡片引用映射', async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        result: JSON.stringify({
          cardMessageId: 'om_card',
          actorOpenId: 'ou_owner',
          chatId: 'oc_target',
          eventIds: ['evt_1', 'evt_2', 'evt_1'],
        }),
      },
    ]);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const service = new OperationStoreService({ select } as never);

    await expect(
      service.getCalendarCardReference('om_card', 'ou_owner', 'oc_target'),
    ).resolves.toEqual(['evt_1', 'evt_2']);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('从旧卡片操作记录中恢复去重的日程引用', async () => {
    const directLimit = jest.fn().mockResolvedValue([]);
    const legacyLimit = jest.fn().mockResolvedValue([
      {
        result: JSON.stringify({
          kind: 'calendar_undo',
          cardMessageId: 'om_card',
          actorOpenId: 'ou_owner',
          chatId: 'oc_target',
          eventId: 'evt_1',
        }),
      },
      {
        result: JSON.stringify({
          kind: 'calendar_mutation',
          cardMessageId: 'om_card',
          actorOpenId: 'ou_owner',
          chatId: 'oc_target',
          after: { eventId: 'evt_2' },
        }),
      },
      {
        result: JSON.stringify({
          kind: 'agenda_action',
          cardMessageId: 'om_card',
          actorOpenId: 'ou_owner',
          chatId: 'oc_target',
          eventId: 'evt_1',
        }),
      },
      {
        result: JSON.stringify({
          kind: 'agenda_action',
          cardMessageId: 'om_card',
          actorOpenId: 'ou_other',
          chatId: 'oc_target',
          eventId: 'evt_private',
        }),
      },
      { result: '{invalid json' },
    ]);
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: directLimit }) }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: legacyLimit }),
          }),
        }),
      });
    const service = new OperationStoreService({ select } as never);

    await expect(
      service.getCalendarCardReference('om_card', 'ou_owner', 'oc_target'),
    ).resolves.toEqual(['evt_1', 'evt_2']);
    expect(legacyLimit).toHaveBeenCalledWith(1000);
  });

  it('操作人或群不匹配时不返回稳定卡片引用', async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        result: JSON.stringify({
          cardMessageId: 'om_card',
          actorOpenId: 'ou_other',
          chatId: 'oc_target',
          eventIds: ['evt_private'],
        }),
      },
    ]);
    const service = new OperationStoreService({
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as never);

    await expect(
      service.getCalendarCardReference('om_card', 'ou_owner', 'oc_target'),
    ).resolves.toEqual([]);
  });

  it('取得最近一条仍有效的删除候选清单', async () => {
    const action = {
      kind: 'calendar_cancel_selection',
      candidates: [
        {
          eventId: 'evt_1',
          summary: '体检',
          startTime: '2026-07-17T00:00:00.000Z',
          endTime: '2026-07-17T01:00:00.000Z',
        },
      ],
      expiresAt: '2026-07-17T00:00:00.000Z',
    };
    const limit = jest.fn().mockResolvedValue([
      {
        content: 'om_candidates',
        result: JSON.stringify(action),
      },
    ]);
    const orderBy = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ orderBy }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const service = new OperationStoreService({ select } as never);

    await expect(
      service.getLatestPendingCancellationSelection(
        new Date('2026-07-16T00:00:00.000Z'),
      ),
    ).resolves.toEqual({ replyMessageId: 'om_candidates', action });
  });
});
