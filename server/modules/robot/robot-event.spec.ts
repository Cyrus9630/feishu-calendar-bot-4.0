import {
  extractCardAction,
  extractRobotInput,
  type RobotScope,
} from './robot-event';

describe('robot-event', () => {
  const scope: RobotScope = {
    chatId: 'oc_target',
    senderOpenId: 'ou_owner',
    botOpenId: 'ou_bot',
    botName: '日程机器人',
  };

  const textEvent = {
    header: { event_type: 'im.message.receive_v1', event_id: 'evt_1' },
    event: {
      sender: { sender_id: { open_id: 'ou_owner' } },
      message: {
        message_id: 'om_text',
        chat_id: 'oc_target',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 17号上午7点体检 黄色' }),
        mentions: [
          {
            key: '@_user_1',
            name: '日程机器人',
            id: { open_id: 'ou_bot' },
          },
        ],
      },
    },
  };

  it('只接受目标用户在目标群中 @机器人的文字', () => {
    expect(extractRobotInput(textEvent, scope)).toEqual({
      kind: 'text',
      messageId: 'om_text',
      parentId: null,
      text: '17号上午7点体检 黄色',
      chatId: 'oc_target',
      senderOpenId: 'ou_owner',
    });

    const noMention = structuredClone(textEvent);
    noMention.event.message.mentions = [];
    expect(extractRobotInput(noMention, scope)).toBeNull();

    const otherSender = structuredClone(textEvent);
    otherSender.event.sender.sender_id.open_id = 'ou_other';
    expect(extractRobotInput(otherSender, scope)).toBeNull();
  });

  it('保留回复消息的 parent_id', () => {
    const reply = structuredClone(textEvent);
    Object.assign(reply.event.message, { parent_id: 'om_bot_reply' });
    expect(extractRobotInput(reply, scope)).toEqual(
      expect.objectContaining({ parentId: 'om_bot_reply' }),
    );
  });

  it('忽略其他群、私聊和其他消息类型', () => {
    const otherChat = structuredClone(textEvent);
    otherChat.event.message.chat_id = 'oc_other';
    expect(extractRobotInput(otherChat, scope)).toBeNull();

    const direct = structuredClone(textEvent);
    direct.event.message.chat_type = 'p2p';
    expect(extractRobotInput(direct, scope)).toBeNull();

    const file = structuredClone(textEvent);
    file.event.message.message_type = 'file';
    expect(extractRobotInput(file, scope)).toBeNull();
  });

  it('只解析目标用户在目标群点击的卡片按钮', () => {
    const body = {
      schema: '2.0',
      header: {
        event_type: 'card.action.trigger',
        event_id: 'evt_card_1',
      },
      event: {
        operator: { open_id: 'ou_owner' },
        context: {
          open_message_id: 'om_card',
          open_chat_id: 'oc_target',
        },
        action: {
          tag: 'button',
          value: { actionId: 'act-1', decision: 'confirm' },
        },
      },
    };
    expect(extractCardAction(body, scope)).toEqual({
      kind: 'card_action',
      callbackId: 'evt_card_1',
      messageId: 'om_card',
      chatId: 'oc_target',
      operatorOpenId: 'ou_owner',
      actionId: 'act-1',
      decision: 'confirm',
    });

    const otherUser = structuredClone(body);
    otherUser.event.operator.open_id = 'ou_other';
    expect(extractCardAction(otherUser, scope)).toBeNull();

    const otherChat = structuredClone(body);
    otherChat.event.context.open_chat_id = 'oc_other';
    expect(extractCardAction(otherChat, scope)).toBeNull();
  });

  it.each(['search_two_years', 'cancel_search'] as const)(
    '解析扩展检索按钮：%s',
    (decision) => {
      const body = {
        header: {
          event_type: 'card.action.trigger',
          event_id: `evt_${decision}`,
        },
        event: {
          operator: { open_id: 'ou_owner' },
          context: {
            open_message_id: 'om_search_card',
            open_chat_id: 'oc_target',
          },
          action: {
            tag: 'button',
            value: { actionId: 'act_search', decision },
          },
        },
      };

      expect(extractCardAction(body, scope)).toEqual(
        expect.objectContaining({
          actionId: 'act_search',
          decision,
          chatId: 'oc_target',
          operatorOpenId: 'ou_owner',
        }),
      );

      const otherUser = structuredClone(body);
      otherUser.event.operator.open_id = 'ou_other';
      expect(extractCardAction(otherUser, scope)).toBeNull();

      const otherChat = structuredClone(body);
      otherChat.event.context.open_chat_id = 'oc_other';
      expect(extractCardAction(otherChat, scope)).toBeNull();
    },
  );
});
