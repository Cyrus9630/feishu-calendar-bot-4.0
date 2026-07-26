import { AgendaActionService } from './agenda-action.service';
import type { AgendaActionPending } from './calendar-action.types';
import type { CardRobotInput } from './robot-event';

describe('AgendaActionService', () => {
  const now = new Date('2026-07-18T01:19:00.000Z');
  const input: CardRobotInput = {
    kind: 'card_action',
    callbackId: 'callback-1',
    messageId: 'om_agenda',
    chatId: 'oc_target',
    operatorOpenId: 'ou_owner',
    actionId: 'agenda-manage-1',
    decision: 'manage',
  };
  const action: AgendaActionPending = {
    kind: 'agenda_action',
    actionId: input.actionId,
    expectedDecision: 'manage',
    actorOpenId: input.operatorOpenId,
    chatId: input.chatId,
    sourceMessageId: 'push:oc_target',
    cardMessageId: input.messageId,
    eventId: 'event-1',
    query: {
      startTime: '2026-07-17T16:00:00.000Z',
      endTime: '2026-07-18T16:00:00.000Z',
      label: '今日日程',
      mentionOpenId: input.operatorOpenId,
    },
    expiresAt: '2026-07-19T01:04:24.000Z',
  };
  const event = {
    eventId: 'event-1',
    summary: '下午会议',
    startTime: new Date('2026-07-18T06:00:00.000Z'),
    endTime: new Date('2026-07-18T07:00:00.000Z'),
    allDay: false,
    color: 0x3370ff,
  };

  function setup(claim: object) {
    const feishu = {
      getCalendarEvent: jest.fn().mockResolvedValue(event),
      updateInteractiveCard: jest.fn().mockResolvedValue(undefined),
      replyTextMessage: jest.fn().mockResolvedValue('om_reply'),
    };
    const store = {
      getCardAction: jest.fn().mockResolvedValue(action),
      claimCardAction: jest.fn().mockResolvedValue(claim),
      saveCardAction: jest.fn().mockResolvedValue(undefined),
      bindCardMessage: jest.fn().mockResolvedValue(undefined),
      completeCardAction: jest.fn().mockResolvedValue(undefined),
    };
    const queries = {
      makeAction: jest.fn(
        (
          decision: AgendaActionPending['expectedDecision'],
          query: AgendaActionPending['query'],
          sourceMessageId: string,
          eventId?: string,
        ): AgendaActionPending => ({
          ...action,
          actionId: `next-${decision}`,
          expectedDecision: decision,
          query,
          sourceMessageId,
          eventId,
          cardMessageId: undefined,
        }),
      ),
    };
    const service = new AgendaActionService(
      feishu as never,
      store as never,
      {} as never,
      queries as never,
    );
    return { service, feishu, store, queries };
  }

  it('首次领取成功后把汇总卡片切换为日程管理卡片', async () => {
    const { service, feishu, store, queries } = setup({
      state: 'claimed',
      action,
    });

    await service.handle(input, now);

    expect(store.claimCardAction).toHaveBeenCalledWith(action.actionId, now);
    expect(feishu.getCalendarEvent).toHaveBeenCalledWith(action.eventId);
    expect(queries.makeAction).toHaveBeenCalledTimes(4);
    expect(store.saveCardAction).toHaveBeenCalledTimes(4);
    expect(store.bindCardMessage).toHaveBeenCalledTimes(4);
    const card = feishu.updateInteractiveCard.mock.calls[0][1];
    const cardJson = JSON.stringify(card);
    expect(cardJson).toContain('管理日程：下午会议');
    expect(cardJson).toContain('推迟 1 小时');
    expect(cardJson).toContain('移到明天 10:00');
    expect(cardJson).toContain('取消日程');
    expect(cardJson).toContain('返回日程列表');
    expect(store.completeCardAction).toHaveBeenCalledWith(
      action.actionId,
      'success',
      'manage',
    );
  });

  it('只有领取状态已结束时才显示无法执行终态', async () => {
    const { service, feishu, store } = setup({ state: 'completed' });

    await service.handle(input, now);

    expect(feishu.getCalendarEvent).not.toHaveBeenCalled();
    expect(store.saveCardAction).not.toHaveBeenCalled();
    expect(feishu.updateInteractiveCard).toHaveBeenCalledTimes(1);
    const cardJson = JSON.stringify(
      feishu.updateInteractiveCard.mock.calls[0][1],
    );
    expect(cardJson).toContain('无法执行');
    expect(cardJson).toContain('该操作已经处理，请勿重复点击。');
    expect(cardJson).toContain('该卡片已结束');
  });
});
