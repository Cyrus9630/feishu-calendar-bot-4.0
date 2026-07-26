export interface RobotScope {
  chatId: string;
  senderOpenId: string;
  botOpenId: string;
  botName: string;
}

export interface TextRobotInput {
  kind: 'text';
  messageId: string;
  parentId: string | null;
  text: string;
  chatId?: string;
  senderOpenId?: string;
}

export type RobotInput = TextRobotInput;

export interface CardRobotInput {
  kind: 'card_action';
  callbackId: string;
  messageId: string;
  chatId: string;
  operatorOpenId: string;
  actionId: string;
  decision:
    | 'confirm'
    | 'decline'
    | 'undo'
    | 'manage'
    | 'postpone_hour'
    | 'tomorrow_10'
    | 'cancel_event'
    | 'back_agenda'
    | 'search_two_years'
    | 'cancel_search';
}

interface FeishuMention {
  key?: string;
  name?: string;
  id?: { open_id?: string };
}

function parseContent(content: unknown): Record<string, string> {
  try {
    return JSON.parse(String(content ?? '')) as Record<string, string>;
  } catch {
    return {};
  }
}

// 刘梦阳律师
export function extractRobotInput(
  body: Record<string, unknown>,
  scope: RobotScope,
): RobotInput | null {
  const header = body.header as Record<string, unknown> | undefined;
  if (header?.event_type !== 'im.message.receive_v1') return null;

  const event = body.event as Record<string, unknown> | undefined;
  const message = event?.message as Record<string, unknown> | undefined;
  const sender = event?.sender as Record<string, unknown> | undefined;
  const senderId = sender?.sender_id as Record<string, unknown> | undefined;
  if (!message || message.chat_type !== 'group') return null;
  if (!scope.chatId || message.chat_id !== scope.chatId) return null;
  if (!scope.senderOpenId || senderId?.open_id !== scope.senderOpenId)
    return null;

  const messageId = String(message.message_id || header.event_id || '');
  if (!messageId) return null;

  if (message.message_type !== 'text') return null;

  const mentions = Array.isArray(message.mentions)
    ? (message.mentions as FeishuMention[])
    : [];
  const botMention = mentions.find((mention) => {
    if (scope.botOpenId && mention.id?.open_id === scope.botOpenId) return true;
    return !!scope.botName && mention.name === scope.botName;
  });
  if (!botMention) return null;

  const text = (parseContent(message.content).text || '')
    .replace(botMention.key || '', '')
    .trim();
  if (!text) return null;
  return {
    kind: 'text',
    messageId,
    parentId: message.parent_id ? String(message.parent_id) : null,
    text,
    chatId: String(message.chat_id),
    senderOpenId: String(senderId.open_id),
  };
}

export function extractCardAction(
  body: Record<string, unknown>,
  scope: RobotScope,
): CardRobotInput | null {
  const header = body.header as Record<string, unknown> | undefined;
  if (header?.event_type !== 'card.action.trigger') return null;
  const event = body.event as Record<string, unknown> | undefined;
  const operator = event?.operator as Record<string, unknown> | undefined;
  const context = event?.context as Record<string, unknown> | undefined;
  const action = event?.action as Record<string, unknown> | undefined;
  const value = action?.value as Record<string, unknown> | undefined;
  const operatorOpenId = String(operator?.open_id || '');
  const chatId = String(context?.open_chat_id || '');
  const messageId = String(context?.open_message_id || '');
  const callbackId = String(header.event_id || '');
  const actionId = String(value?.actionId || '');
  const decision = String(value?.decision || '');
  if (
    !scope.chatId ||
    chatId !== scope.chatId ||
    !scope.senderOpenId ||
    operatorOpenId !== scope.senderOpenId ||
    !callbackId ||
    !messageId ||
    !actionId ||
    ![
      'confirm',
      'decline',
      'undo',
      'manage',
      'postpone_hour',
      'tomorrow_10',
      'cancel_event',
      'back_agenda',
      'search_two_years',
      'cancel_search',
    ].includes(decision)
  ) {
    return null;
  }
  return {
    kind: 'card_action',
    callbackId,
    messageId,
    chatId,
    operatorOpenId,
    actionId,
    decision: decision as CardRobotInput['decision'],
  };
}
