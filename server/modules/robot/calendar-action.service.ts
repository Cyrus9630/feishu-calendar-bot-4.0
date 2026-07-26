import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { TextRobotInput, CardRobotInput } from './robot-event';
import { FeishuService, type CalendarEventRecord } from './feishu.service';
import { OperationStoreService, stableUuid } from './operation-store.service';
import {
  buildPendingCalendarCard,
  buildSuccessCalendarCard,
  buildTerminalCalendarCard,
  type CalendarCardDetail,
} from './interactive-card';
import type {
  CalendarEventSnapshot,
  CalendarMutationPending,
  CalendarOperation,
  CalendarUndoPending,
} from './calendar-action.types';
import { EVENT_COLORS, type EventColorName } from './schedule-command';
import { describeScheduleRecurrence } from './schedule-recurrence';

const DAY_MS = 24 * 60 * 60 * 1000;
const UNDO_MS = 10 * 60 * 1000;

export interface CalendarActionDraft {
  operation: CalendarOperation;
  sourceOperationId?: string;
  eventId?: string;
  before?: CalendarEventSnapshot;
  after?: CalendarEventSnapshot;
  display?: CalendarEventSnapshot;
  truncatedRecurrence?: string;
  red: boolean;
  conflicts: CalendarEventRecord[];
  restorable?: boolean;
  details?: CalendarCardDetail[];
}

@Injectable()
export class CalendarActionService {
  private readonly logger = new Logger(CalendarActionService.name);

  constructor(
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
  ) {}

  async promptMutation(
    input: TextRobotInput | { messageId: string },
    draft: CalendarActionDraft,
    now = new Date(),
  ): Promise<string> {
    const action = this.toPending(input.messageId, draft, now);
    await this.store.saveCardAction(action);
    try {
      const cardMessageId = await this.feishu.replyInteractiveCard(
        input.messageId,
        this.pendingCard(action, draft.details, draft.conflicts),
        stableUuid(`card:${action.actionId}`),
      );
      await this.store.bindCardMessage(action.actionId, cardMessageId);
      return cardMessageId;
    } catch (error) {
      await this.store.completeCardAction(
        action.actionId,
        'fail',
        'card-send-failed',
        this.errorText(error),
      );
      throw error;
    }
  }

  async executeDirect(
    input: TextRobotInput | { messageId: string },
    draft: CalendarActionDraft,
    now = new Date(),
  ): Promise<void> {
    const action = this.toPending(input.messageId, draft, now);
    const executed = await this.execute(action);
    try {
      const undo = this.makeUndo(executed, now);
      if (undo) await this.store.saveCardAction(undo);
      const cardMessageId = await this.feishu.replyInteractiveCard(
        input.messageId,
        this.successCard(executed, undo),
        stableUuid(`card-success:${action.actionId}`),
      );
      if (undo) await this.store.bindCardMessage(undo.actionId, cardMessageId);
      await this.saveCalendarCardReferenceSafely(cardMessageId, executed);
    } catch (error) {
      this.logger.error(`日历已写入但成功卡发送失败: ${this.errorText(error)}`);
      try {
        await this.feishu.replyTextMessage(
          input.messageId,
          `${this.successTitle(executed)}，但结果卡发送失败；请以飞书日历中的实际记录为准。`,
          stableUuid(`calendar-success-fallback:${action.actionId}`),
        );
      } catch (replyError) {
        this.logger.error(
          `日历已写入但成功文字反馈也发送失败: ${this.errorText(replyError)}`,
        );
      }
    }
  }

  async handleCardAction(
    input: CardRobotInput,
    now = new Date(),
  ): Promise<void> {
    const existing = await this.store.getCardAction(input.actionId);
    if (
      !existing ||
      existing.actorOpenId !== input.operatorOpenId ||
      existing.chatId !== input.chatId
    ) {
      await this.safeTerminal(
        input.messageId,
        '操作无效',
        '该操作不存在，或不属于当前用户。',
        'failed',
      );
      return;
    }
    if (existing.cardMessageId && existing.cardMessageId !== input.messageId) {
      await this.safeTerminal(
        input.messageId,
        '操作无效',
        '卡片与操作记录不匹配。',
        'failed',
      );
      return;
    }
    const claim = await this.store.claimCardAction(input.actionId, now);
    if (claim.state !== 'claimed') {
      const message =
        claim.state === 'expired'
          ? '该操作已过有效期，请重新发送指令。'
          : '该操作已经处理，请勿重复点击。';
      await this.safeTerminal(
        input.messageId,
        '无法执行',
        message,
        claim.state === 'expired' ? 'expired' : 'failed',
      );
      return;
    }
    const action = claim.action;
    let calendarChanged = false;
    try {
      if (input.decision === 'decline' && action.kind === 'calendar_mutation') {
        await this.store.completeCardAction(
          action.actionId,
          'success',
          'declined',
        );
        if (action.cardMessageId) {
          await this.store.completePending(
            action.cardMessageId,
            'fail',
            'declined',
          );
        }
        await this.safeTerminal(
          input.messageId,
          '已暂不执行',
          '飞书日历没有发生变更。',
          'cancelled',
        );
        return;
      }
      if (input.decision === 'undo' && action.kind === 'calendar_undo') {
        await this.undo(action);
        calendarChanged = true;
        await this.store.completeCardAction(
          action.actionId,
          'success',
          'undone',
        );
        await this.safeTerminal(
          input.messageId,
          '撤销成功',
          '本次日程操作已撤销。',
          'success',
        );
        return;
      }
      if (input.decision !== 'confirm' || action.kind !== 'calendar_mutation') {
        throw new Error('按钮操作与服务端记录不匹配');
      }
      const refreshed = await this.refreshForNewConflicts(action, now);
      if (refreshed) {
        await this.store.completeCardAction(
          action.actionId,
          'success',
          'refreshed',
        );
        return;
      }
      const executed = await this.execute(action);
      calendarChanged = true;
      try {
        const undo = this.makeUndo(executed, now);
        if (undo) {
          undo.cardMessageId = input.messageId;
          await this.store.saveCardAction(undo);
        }
        await this.store.completeCardAction(
          action.actionId,
          'success',
          'executed',
        );
        if (action.cardMessageId) {
          await this.store.completePending(
            action.cardMessageId,
            'success',
            'executed',
          );
        }
        await this.feishu.updateInteractiveCard(
          input.messageId,
          this.successCard(executed, undo),
        );
        await this.saveCalendarCardReferenceSafely(input.messageId, executed);
      } catch (feedbackError) {
        this.logger.error(
          `日历已写入但结果处理失败: ${this.errorText(feedbackError)}`,
        );
        await this.store.completeCardAction(
          action.actionId,
          'success',
          'executed-feedback-failed',
          this.errorText(feedbackError),
        );
        await this.feishu.replyTextMessage(
          input.messageId,
          `${this.successTitle(executed)}，但结果卡刷新失败；请以飞书日历中的实际记录为准。`,
          stableUuid(`calendar-success-fallback:${action.actionId}`),
        );
      }
    } catch (error) {
      if (calendarChanged) {
        this.logger.error(`日历已变更但结果反馈失败: ${this.errorText(error)}`);
        await this.safeTerminal(
          input.messageId,
          '日程操作成功',
          '飞书日历已经变更，但操作记录或结果反馈保存失败；请以日历中的实际记录为准。',
          'success',
        );
        return;
      }
      try {
        await this.store.completeCardAction(
          action.actionId,
          'fail',
          'failed',
          this.errorText(error),
        );
      } catch (storeError) {
        this.logger.error(`保存失败状态失败: ${this.errorText(storeError)}`);
      }
      await this.safeTerminal(
        input.messageId,
        '执行失败',
        `${this.errorText(error)}。飞书日历未按本次操作变更。`,
        'failed',
      );
    }
  }

  snapshot(event: CalendarEventRecord): CalendarEventSnapshot {
    const color = event.color ?? EVENT_COLORS.蓝色;
    return {
      eventId: event.eventId,
      summary: event.summary,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      description: event.description,
      location: event.location,
      color,
      colorName: this.colorName(color),
      reminders: event.reminders ?? [30],
      recurrence: event.recurrence,
      recurrenceText: describeScheduleRecurrence(
        event.recurrence,
        event.startTime,
      ),
      allDay: event.allDay,
    };
  }

  private toPending(
    sourceMessageId: string,
    draft: CalendarActionDraft,
    now: Date,
  ): CalendarMutationPending {
    const start = draft.after?.startTime || draft.before?.startTime;
    const maximum = now.getTime() + DAY_MS;
    const startMs = start ? new Date(start).getTime() : maximum;
    const expiresAt = new Date(
      Math.max(now.getTime() + 60_000, Math.min(maximum, startMs)),
    ).toISOString();
    return {
      kind: 'calendar_mutation',
      actionId: randomUUID(),
      operation: draft.operation,
      actorOpenId:
        process.env.TARGET_OPEN_ID ||
        process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
        '',
      chatId:
        process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '',
      sourceMessageId: draft.sourceOperationId || sourceMessageId,
      eventId: draft.eventId,
      before: draft.before,
      after: draft.after,
      display: draft.display,
      truncatedRecurrence: draft.truncatedRecurrence,
      red: draft.red,
      conflictIds: draft.conflicts.map((event) => event.eventId),
      restorable: draft.restorable ?? true,
      expiresAt,
    };
  }

  private async execute(
    action: CalendarMutationPending,
  ): Promise<CalendarMutationPending> {
    if (action.operation === 'create' && action.after) {
      const after = action.after;
      const eventId = await this.feishu.createCalendarEvent(
        this.eventInfo(after),
        stableUuid(`calendar-action:${action.actionId}`),
      );
      const executed = { ...action, eventId, after: { ...after, eventId } };
      await this.recordCreatedEventSafely(
        action.sourceMessageId,
        executed.after,
      );
      return executed;
    }
    if (
      action.operation === 'update' &&
      action.eventId &&
      action.before &&
      action.after
    ) {
      await this.assertCurrent(action.eventId, action.before);
      await this.feishu.patchCalendarEvent(
        action.eventId,
        this.eventInfo(action.after),
      );
      return action;
    }
    if (action.operation === 'cancel' && action.eventId && action.before) {
      await this.assertCurrent(action.eventId, action.before);
      await this.feishu.deleteCalendarEvent(action.eventId);
      return action;
    }
    if (
      action.operation === 'cancel_future' &&
      action.eventId &&
      action.before &&
      action.truncatedRecurrence
    ) {
      await this.assertCurrent(action.eventId, action.before);
      await this.feishu.patchCalendarEvent(action.eventId, {
        recurrence: action.truncatedRecurrence,
      });
      return action;
    }
    if (
      action.operation === 'update_future' &&
      action.eventId &&
      action.before &&
      action.after &&
      action.truncatedRecurrence
    ) {
      await this.assertCurrent(action.eventId, action.before);
      await this.feishu.patchCalendarEvent(action.eventId, {
        recurrence: action.truncatedRecurrence,
      });
      try {
        const newEventId = await this.feishu.createCalendarEvent(
          this.eventInfo(action.after),
          stableUuid(`calendar-action:${action.actionId}:future`),
        );
        const executed = {
          ...action,
          after: { ...action.after, eventId: newEventId },
        };
        await this.recordCreatedEventSafely(
          action.sourceMessageId,
          executed.after,
        );
        return executed;
      } catch (error) {
        try {
          await this.feishu.patchCalendarEvent(action.eventId, {
            recurrence: action.before.recurrence,
          });
        } catch (rollbackError) {
          this.logger.error(
            `拆分重复日程失败且回滚原系列失败: ${this.errorText(rollbackError)}`,
          );
        }
        throw error;
      }
    }
    throw new Error('日程操作数据不完整');
  }

  private async refreshForNewConflicts(
    action: CalendarMutationPending,
    now: Date,
  ): Promise<boolean> {
    if (
      !action.after ||
      action.operation === 'cancel' ||
      action.operation === 'cancel_future'
    )
      return false;
    const start = new Date(action.after.startTime);
    const end = new Date(action.after.endTime);
    const events = await this.feishu.listCalendarEvents(start, end);
    const conflicts = events.filter(
      (event) =>
        event.eventId !== action.eventId &&
        event.eventId !== action.display?.eventId &&
        (!action.after?.allDay || event.allDay) &&
        event.startTime < end &&
        event.endTime > start,
    );
    const hasNew = conflicts.some(
      (event) => !action.conflictIds.includes(event.eventId),
    );
    if (!hasNew) return false;
    const refreshed: CalendarMutationPending = {
      ...action,
      actionId: randomUUID(),
      cardMessageId: action.cardMessageId,
      conflictIds: conflicts.map((event) => event.eventId),
      expiresAt: new Date(
        Math.min(now.getTime() + DAY_MS, start.getTime()),
      ).toISOString(),
    };
    await this.store.saveCardAction(refreshed);
    await this.feishu.updateInteractiveCard(
      action.cardMessageId || '',
      this.pendingCard(refreshed, undefined, conflicts),
    );
    return true;
  }

  private async undo(action: CalendarUndoPending): Promise<void> {
    if (action.operation === 'create' && action.eventId && action.after) {
      await this.assertCurrent(action.eventId, action.after);
      await this.feishu.deleteCalendarEvent(action.eventId);
      return;
    }
    if (
      action.operation === 'update' &&
      action.eventId &&
      action.before &&
      action.after
    ) {
      await this.assertCurrent(action.eventId, action.after);
      await this.feishu.patchCalendarEvent(
        action.eventId,
        this.eventInfo(action.before),
      );
      return;
    }
    if (action.operation === 'cancel' && action.before) {
      await this.feishu.createCalendarEvent(
        this.eventInfo(action.before),
        stableUuid(`calendar-undo:${action.actionId}`),
      );
      return;
    }
    if (
      action.operation === 'cancel_future' &&
      action.eventId &&
      action.before
    ) {
      await this.feishu.patchCalendarEvent(
        action.eventId,
        this.eventInfo(action.before),
      );
      return;
    }
    if (
      action.operation === 'update_future' &&
      action.eventId &&
      action.before &&
      action.after?.eventId
    ) {
      await this.assertCurrent(action.after.eventId, action.after);
      await this.feishu.deleteCalendarEvent(action.after.eventId);
      await this.feishu.patchCalendarEvent(
        action.eventId,
        this.eventInfo(action.before),
      );
      return;
    }
    throw new Error('该操作不能撤销');
  }

  private makeUndo(
    action: CalendarMutationPending,
    now: Date,
  ): CalendarUndoPending | null {
    if (action.operation === 'cancel' && !action.restorable) return null;
    return {
      kind: 'calendar_undo',
      actionId: randomUUID(),
      operation: action.operation,
      actorOpenId: action.actorOpenId,
      chatId: action.chatId,
      sourceMessageId: action.sourceMessageId,
      eventId: action.eventId,
      before: action.before,
      after: action.after,
      display: action.display,
      truncatedRecurrence: action.truncatedRecurrence,
      expiresAt: new Date(now.getTime() + UNDO_MS).toISOString(),
    };
  }

  private async assertCurrent(
    eventId: string,
    expected: CalendarEventSnapshot,
  ): Promise<void> {
    const current = await this.feishu.getCalendarEvent(eventId);
    if (!current) throw new Error('目标日程已不存在');
    if (!this.sameSnapshot(this.snapshot(current), expected)) {
      throw new Error('目标日程已被其他操作修改，为避免覆盖，本次操作已停止');
    }
  }

  private sameSnapshot(
    a: CalendarEventSnapshot,
    b: CalendarEventSnapshot,
  ): boolean {
    return (
      a.summary === b.summary &&
      a.startTime === b.startTime &&
      a.endTime === b.endTime &&
      !!a.allDay === !!b.allDay &&
      (a.description || '') === (b.description || '') &&
      (a.location || '') === (b.location || '') &&
      a.color === b.color &&
      (a.recurrence || '') === (b.recurrence || '') &&
      JSON.stringify(a.reminders) === JSON.stringify(b.reminders)
    );
  }

  private eventInfo(snapshot: CalendarEventSnapshot) {
    return {
      summary: snapshot.summary,
      startTime: new Date(snapshot.startTime),
      endTime: new Date(snapshot.endTime),
      description: snapshot.description,
      location: snapshot.location,
      color: snapshot.color,
      reminders: snapshot.reminders,
      recurrence: snapshot.recurrence,
      allDay: snapshot.allDay,
    };
  }

  private pendingCard(
    action: CalendarMutationPending,
    details?: CalendarCardDetail[],
    conflicts?: CalendarEventRecord[],
  ) {
    const event = action.display || action.after || action.before;
    if (!event) throw new Error('日程卡片数据不完整');
    return buildPendingCalendarCard({
      actionId: action.actionId,
      operation: action.operation,
      summary: event.summary,
      timeText: this.formatRange(event),
      colorName: event.colorName,
      location: event.location,
      red: action.red,
      conflicts: (conflicts || []).length
        ? (conflicts || []).map((item) => this.formatEvent(item))
        : action.conflictIds.map((id) => `冲突日程 ${id.slice(0, 8)}`),
      expiresAt: action.expiresAt,
      restorable: action.restorable,
      details,
      recurrenceText: event.recurrenceText,
    });
  }

  private successCard(
    action: CalendarMutationPending,
    undo: CalendarUndoPending | null,
  ) {
    const event = action.display || action.after || action.before;
    if (!event) throw new Error('日程结果数据不完整');
    const title = this.successTitle(action);
    return buildSuccessCalendarCard({
      title,
      summary: event.summary,
      timeText: this.formatRange(event),
      colorName: event.colorName,
      location: event.location,
      undoActionId: undo?.actionId,
      undoExpiresAt: undo?.expiresAt,
      recurrenceText: event.recurrenceText,
    });
  }

  private successTitle(action: CalendarMutationPending) {
    return action.operation === 'create'
      ? '日程创建成功'
      : action.operation === 'update' || action.operation === 'update_future'
        ? '日程修改成功'
        : '日程取消成功';
  }

  private async recordCreatedEventSafely(
    sourceMessageId: string,
    event: CalendarEventSnapshot & { eventId: string },
  ): Promise<void> {
    try {
      await this.store.recordCreatedEvent(sourceMessageId, event);
    } catch (error) {
      this.logger.error(
        `日历已创建但操作记录保存失败: ${this.errorText(error)}`,
      );
    }
  }

  private async saveCalendarCardReferenceSafely(
    cardMessageId: string,
    action: CalendarMutationPending,
  ): Promise<void> {
    const eventId =
      action.eventId || action.after?.eventId || action.display?.eventId;
    if (!eventId) return;
    try {
      await this.store.saveCalendarCardReference(cardMessageId, {
        actorOpenId: action.actorOpenId,
        chatId: action.chatId,
        eventIds: [eventId],
      });
    } catch (error) {
      this.logger.error(
        `日历已更新但卡片引用保存失败: ${this.errorText(error)}`,
      );
      try {
        await this.feishu.replyTextMessage(
          cardMessageId,
          '日历已更新，但卡片引用暂不可用；后续修改请直接说明日程名称和时间。',
          stableUuid(`calendar-card-reference-fallback:${cardMessageId}`),
        );
      } catch (replyError) {
        this.logger.error(
          `发送卡片引用失败提示失败: ${this.errorText(replyError)}`,
        );
      }
    }
  }

  private async safeTerminal(
    messageId: string,
    title: string,
    message: string,
    status: 'success' | 'cancelled' | 'expired' | 'failed',
  ) {
    try {
      await this.feishu.updateInteractiveCard(
        messageId,
        buildTerminalCalendarCard({ title, message, status }),
      );
    } catch (error) {
      this.logger.error(`更新卡片终态失败: ${this.errorText(error)}`);
      try {
        await this.feishu.replyTextMessage(
          messageId,
          `${title}：${message}`,
          stableUuid(`card-terminal:${messageId}:${title}`),
        );
      } catch (replyError) {
        this.logger.error(
          `发送卡片结果文字失败: ${this.errorText(replyError)}`,
        );
      }
    }
  }

  private colorName(color: number): EventColorName {
    return (
      (Object.entries(EVENT_COLORS).find(
        ([, value]) => value === color,
      )?.[0] as EventColorName | undefined) || '蓝色'
    );
  }

  private formatRange(event: CalendarEventSnapshot) {
    if (event.allDay) {
      const inclusiveEnd = new Date(new Date(event.endTime).getTime() - 1);
      const start = this.formatDate(new Date(event.startTime));
      const end = this.formatDate(inclusiveEnd);
      return start === end ? `${start} 全天` : `${start} 至 ${end} 全天`;
    }
    return `${this.formatDate(new Date(event.startTime))} ${this.formatTime(new Date(event.startTime))}-${this.formatTime(new Date(event.endTime))}`;
  }

  private formatEvent(event: CalendarEventRecord) {
    return `${this.formatTime(event.startTime)}-${this.formatTime(event.endTime)}｜${event.summary}`;
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .replaceAll('/', '-');
  }

  private formatTime(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
