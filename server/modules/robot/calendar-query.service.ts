import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FeishuService, type CalendarEventRecord } from './feishu.service';
import { OperationStoreService, stableUuid } from './operation-store.service';
import { buildAgendaCard } from './agenda-card';
import type {
  AgendaActionPending,
  AgendaQuerySnapshot,
} from './calendar-action.types';
import type { ScheduleQuery } from './schedule-query';

const MAX_CARD_ITEMS = 20;
const ACTION_TTL = 24 * 60 * 60 * 1000;

@Injectable()
export class CalendarQueryService {
  private readonly logger = new Logger(CalendarQueryService.name);

  constructor(
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
  ) {}

  async load(
    query: ScheduleQuery | AgendaQuerySnapshot,
  ): Promise<CalendarEventRecord[]> {
    const start = 'start' in query ? query.start : new Date(query.startTime);
    const end = 'end' in query ? query.end : new Date(query.endTime);
    const color = query.color;
    return (await this.feishu.listCalendarEvents(start, end))
      .filter((event) => color === undefined || event.color === color)
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.startTime.getTime() - b.startTime.getTime(),
      );
  }

  async reply(messageId: string, query: ScheduleQuery, title = '日程查询结果') {
    const events = await this.load(query);
    await this.sendCard('reply', messageId, query, events, title);
  }

  async push(
    chatId: string,
    query: ScheduleQuery,
    events: CalendarEventRecord[],
    title: string,
    mentionOpenId: string,
    idempotencyKey: string,
  ) {
    await this.sendCard(
      'push',
      chatId,
      { ...query, mentionOpenId },
      events,
      title,
      idempotencyKey,
    );
  }

  async replace(messageId: string, query: AgendaQuerySnapshot) {
    const events = await this.load(query);
    const prepared = await this.prepare(
      query,
      events,
      `agenda-back:${messageId}`,
    );
    await this.feishu.updateInteractiveCard(
      messageId,
      buildAgendaCard({
        title: '日程安排',
        rangeLabel: query.label,
        total: events.length,
        items: prepared.items,
        mentionOpenId: query.mentionOpenId,
      }),
    );
    await Promise.all(
      prepared.actions.map((action) =>
        this.store.bindCardMessage(action.actionId, messageId),
      ),
    );
    await this.saveCalendarCardReference(messageId, prepared.items);
  }

  makeAction(
    decision: AgendaActionPending['expectedDecision'],
    query: AgendaQuerySnapshot,
    sourceMessageId: string,
    eventId?: string,
  ) {
    return this.action(decision, query, sourceMessageId, eventId);
  }

  private async sendCard(
    mode: 'reply' | 'push',
    targetId: string,
    query: ScheduleQuery & { mentionOpenId?: string },
    events: CalendarEventRecord[],
    title: string,
    idempotencyKey?: string,
  ) {
    const snapshot = this.snapshot(query);
    const prepared = await this.prepare(
      snapshot,
      events,
      `${mode}:${targetId}`,
    );
    const card = buildAgendaCard({
      title,
      rangeLabel: query.label,
      total: events.length,
      items: prepared.items,
      mentionOpenId: query.mentionOpenId,
    });
    const cardMessageId =
      mode === 'reply'
        ? await this.feishu.replyInteractiveCard(
            targetId,
            card,
            stableUuid(`agenda-reply:${targetId}`),
          )
        : await this.feishu.sendInteractiveCard(
            targetId,
            card,
            idempotencyKey ||
              stableUuid(`agenda-push:${targetId}:${query.label}`),
          );
    await Promise.all(
      prepared.actions.map((action) =>
        this.store.bindCardMessage(action.actionId, cardMessageId),
      ),
    );
    await this.saveCalendarCardReference(cardMessageId, prepared.items);
  }

  private async saveCalendarCardReference(
    cardMessageId: string,
    items: Array<{ event: CalendarEventRecord }>,
  ) {
    try {
      await this.store.saveCalendarCardReference(cardMessageId, {
        actorOpenId:
          process.env.TARGET_OPEN_ID ||
          process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
          '',
        chatId:
          process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '',
        eventIds: [...new Set(items.map(({ event }) => event.eventId))],
      });
    } catch (error) {
      this.logger.error(
        `日程卡已发送但卡片引用保存失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async prepare(
    query: AgendaQuerySnapshot,
    events: CalendarEventRecord[],
    sourceMessageId: string,
  ) {
    const actions: AgendaActionPending[] = [];
    const items = events.slice(0, MAX_CARD_ITEMS).map((event) => {
      const action = this.action(
        'manage',
        query,
        sourceMessageId,
        event.eventId,
      );
      actions.push(action);
      return { event, manageActionId: action.actionId };
    });
    await Promise.all(
      actions.map((action) => this.store.saveCardAction(action)),
    );
    return { items, actions };
  }

  private action(
    decision: AgendaActionPending['expectedDecision'],
    query: AgendaQuerySnapshot,
    sourceMessageId: string,
    eventId?: string,
  ): AgendaActionPending {
    return {
      kind: 'agenda_action',
      actionId: randomUUID(),
      expectedDecision: decision,
      actorOpenId:
        process.env.TARGET_OPEN_ID ||
        process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
        '',
      chatId:
        process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '',
      sourceMessageId,
      eventId,
      query,
      expiresAt: new Date(Date.now() + ACTION_TTL).toISOString(),
    };
  }

  private snapshot(
    query: ScheduleQuery & { mentionOpenId?: string },
  ): AgendaQuerySnapshot {
    return {
      startTime: query.start.toISOString(),
      endTime: query.end.toISOString(),
      label: query.label,
      color: query.color,
      mentionOpenId: query.mentionOpenId,
    };
  }
}
