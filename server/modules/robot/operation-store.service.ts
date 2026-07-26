import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { createHash } from 'crypto';
import { operationLog } from '@server/database/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  OperationLogStatus,
  OperationLogType,
} from '@shared/api.interface';
import type { StoredCardAction } from './calendar-action.types';
import type { StoredCalendarUpdateRequest } from './calendar-update-search';

export interface PendingCalendarEvent {
  summary: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  color: number;
  colorName: string;
  reminders: number[];
  recurrence?: string;
  recurrenceText?: string;
  allDay?: boolean;
}

export interface CalendarCancelPending {
  kind: 'calendar_cancel';
  eventId: string;
  summary: string;
  timeText: string;
}

export interface CalendarCancelSelectionPending {
  kind: 'calendar_cancel_selection';
  candidates: Array<{
    eventId: string;
    summary: string;
    startTime: string;
    endTime: string;
  }>;
}

export interface CalendarUpdateSelectionPending {
  kind: 'calendar_update_selection';
  request: StoredCalendarUpdateRequest;
  candidates: Array<{
    eventId: string;
    summary: string;
    startTime: string;
    endTime: string;
  }>;
}

export type PendingAction =
  | CalendarCancelPending
  | CalendarCancelSelectionPending
  | CalendarUpdateSelectionPending;
export type StoredPendingAction = PendingAction & { expiresAt: string };

export type PendingLookup =
  | { state: 'pending'; action: StoredPendingAction }
  | { state: 'completed' }
  | { state: 'missing' };

export type PendingClaim =
  | { state: 'claimed'; action: StoredPendingAction }
  | { state: 'expired' | 'completed' | 'missing' };

export interface LatestCalendarCancelSelection {
  replyMessageId: string;
  action: CalendarCancelSelectionPending & { expiresAt: string };
}

export interface RecentCreatedEvent {
  eventId: string;
  summary: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  color?: number;
  colorName?: string;
  reminders?: number[];
  recurrence?: string;
  recurrenceText?: string;
  allDay?: boolean;
}

export type CardActionClaim =
  | { state: 'claimed'; action: StoredCardAction }
  | { state: 'expired' | 'completed' | 'missing' };

export interface HealthIncidentState {
  active: boolean;
  message: string;
  updatedAt: string;
}

interface CalendarCardReferenceRecord {
  cardMessageId: string;
  actorOpenId: string;
  chatId: string;
  eventIds: string[];
}

interface LegacyCalendarCardAction {
  cardMessageId?: string;
  actorOpenId?: string;
  chatId?: string;
  eventId?: string;
  after?: { eventId?: string };
  display?: { eventId?: string };
}

export function stableUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

@Injectable()
export class OperationStoreService {
  private readonly logger = new Logger(OperationStoreService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async claimMessage(messageId: string, _kind: 'text') {
    return this.claim(
      stableUuid(`message:${messageId}`),
      'message_process',
      messageId,
    );
  }

  async completeMessage(
    messageId: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result = '',
    errorMsg: string | null = null,
  ) {
    await this.complete(
      stableUuid(`message:${messageId}`),
      status,
      result,
      errorMsg,
    );
  }

  async claimCardCallback(callbackId: string) {
    return this.claim(
      stableUuid(`card-callback:${callbackId}`),
      'card_action',
      callbackId,
    );
  }

  async completeCardCallback(
    callbackId: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result: string,
    errorMsg: string | null = null,
  ) {
    await this.complete(
      stableUuid(`card-callback:${callbackId}`),
      status,
      result,
      errorMsg,
    );
  }

  async savePending(
    replyMessageId: string,
    action: PendingAction,
    now: Date = new Date(),
  ) {
    const stored: StoredPendingAction = {
      ...action,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.db
      .insert(operationLog)
      .values({
        id: stableUuid(`pending:${replyMessageId}`),
        type: 'pending_action',
        status: 'processing',
        content: replyMessageId,
        result: JSON.stringify(stored),
        errorMsg: null,
      })
      .onConflictDoUpdate({
        target: operationLog.id,
        set: {
          status: 'processing',
          result: JSON.stringify(stored),
          errorMsg: null,
        },
      });
  }

  async getPending(
    replyMessageId: string,
    now: Date = new Date(),
  ): Promise<PendingLookup> {
    const rows = await this.db
      .select({ status: operationLog.status, result: operationLog.result })
      .from(operationLog)
      .where(eq(operationLog.id, stableUuid(`pending:${replyMessageId}`)))
      .limit(1);
    const row = rows[0];
    if (!row) return { state: 'missing' };
    if (row.status !== 'processing') return { state: 'completed' };
    try {
      const action = JSON.parse(row.result) as StoredPendingAction;
      if (!action.expiresAt || new Date(action.expiresAt) <= now) {
        await this.complete(
          stableUuid(`pending:${replyMessageId}`),
          'fail',
          'expired',
          '待确认记录已过期',
        );
        return { state: 'missing' };
      }
      return { state: 'pending', action };
    } catch (error) {
      this.logger.error(`待确认记录解析失败: ${String(error)}`);
      return { state: 'missing' };
    }
  }

  async claimPending(
    replyMessageId: string,
    now: Date = new Date(),
  ): Promise<PendingClaim> {
    const id = stableUuid(`pending:${replyMessageId}`);
    const rows = await this.db
      .update(operationLog)
      .set({ status: 'claimed', updatedAt: now })
      .where(and(eq(operationLog.id, id), eq(operationLog.status, 'processing')))
      .returning({ result: operationLog.result });
    if (rows.length === 0) {
      const existing = await this.getPending(replyMessageId, now);
      return {
        state: existing.state === 'missing' ? 'missing' : 'completed',
      };
    }
    try {
      const action = JSON.parse(rows[0].result) as StoredPendingAction;
      if (!action.expiresAt || new Date(action.expiresAt) <= now) {
        await this.complete(id, 'fail', 'expired', '待确认记录已过期');
        return { state: 'expired' };
      }
      return { state: 'claimed', action };
    } catch (error) {
      await this.complete(
        id,
        'fail',
        'invalid',
        error instanceof Error ? error.message : String(error),
      );
      return { state: 'missing' };
    }
  }

  async getLatestPendingCancellationSelection(
    now: Date = new Date(),
  ): Promise<LatestCalendarCancelSelection | null> {
    const rows = await this.db
      .select({ content: operationLog.content, result: operationLog.result })
      .from(operationLog)
      .where(
        and(
          eq(operationLog.type, 'pending_action'),
          eq(operationLog.status, 'processing'),
        ),
      )
      .orderBy(desc(operationLog.updatedAt))
      .limit(50);
    for (const row of rows) {
      try {
        const action = JSON.parse(row.result) as StoredPendingAction;
        if (
          action.kind === 'calendar_cancel_selection' &&
          action.expiresAt &&
          new Date(action.expiresAt) > now
        ) {
          return { replyMessageId: row.content, action };
        }
      } catch {
        // Ignore malformed or unrelated pending rows and continue searching.
      }
    }
    return null;
  }

  async completePending(
    replyMessageId: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result: string,
  ) {
    await this.complete(
      stableUuid(`pending:${replyMessageId}`),
      status,
      result,
    );
  }

  async saveCalendarCardReference(
    cardMessageId: string,
    reference: Omit<CalendarCardReferenceRecord, 'cardMessageId'>,
  ): Promise<void> {
    const stored: CalendarCardReferenceRecord = {
      cardMessageId,
      actorOpenId: reference.actorOpenId,
      chatId: reference.chatId,
      eventIds: this.uniqueEventIds(reference.eventIds),
    };
    await this.retryIdempotentWrite('保存卡片日程引用', async () => {
      await this.db
        .insert(operationLog)
        .values({
          id: stableUuid(`calendar-card-reference:${cardMessageId}`),
          type: 'calendar_card_reference',
          status: 'success',
          content: cardMessageId,
          result: JSON.stringify(stored),
          errorMsg: null,
        })
        .onConflictDoUpdate({
          target: operationLog.id,
          set: {
            status: 'success',
            content: cardMessageId,
            result: JSON.stringify(stored),
            errorMsg: null,
            updatedAt: new Date(),
          },
        });
    });
  }

  async getCalendarCardReference(
    cardMessageId: string,
    actorOpenId: string,
    chatId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ result: operationLog.result })
      .from(operationLog)
      .where(
        eq(
          operationLog.id,
          stableUuid(`calendar-card-reference:${cardMessageId}`),
        ),
      )
      .limit(1);
    if (rows[0]) {
      try {
        const reference = JSON.parse(
          rows[0].result,
        ) as CalendarCardReferenceRecord;
        if (
          reference.cardMessageId !== cardMessageId ||
          reference.actorOpenId !== actorOpenId ||
          reference.chatId !== chatId
        ) {
          return [];
        }
        return this.uniqueEventIds(reference.eventIds);
      } catch {
        return [];
      }
    }

    const legacyRows = await this.db
      .select({ result: operationLog.result })
      .from(operationLog)
      .where(
        inArray(operationLog.type, [
          'calendar_undo',
          'calendar_action',
          'agenda_action',
        ]),
      )
      .orderBy(desc(operationLog.updatedAt))
      .limit(1000);
    const eventIds: string[] = [];
    for (const row of legacyRows) {
      try {
        const action = JSON.parse(row.result) as LegacyCalendarCardAction;
        if (
          action.cardMessageId !== cardMessageId ||
          action.actorOpenId !== actorOpenId ||
          action.chatId !== chatId
        ) {
          continue;
        }
        const eventId =
          action.eventId ?? action.after?.eventId ?? action.display?.eventId;
        if (eventId) eventIds.push(eventId);
      } catch {
        // Ignore malformed historical rows and continue recovering valid references.
      }
    }
    return this.uniqueEventIds(eventIds);
  }

  async saveCardAction(action: StoredCardAction): Promise<void> {
    await this.retryIdempotentWrite('保存卡片操作', async () => {
      await this.db
        .insert(operationLog)
        .values({
          id: stableUuid(`card-action:${action.actionId}`),
          type:
            action.kind === 'calendar_undo'
              ? 'calendar_undo'
              : action.kind === 'agenda_action'
                ? 'agenda_action'
                : 'calendar_action',
          status: 'processing',
          content: action.sourceMessageId,
          result: JSON.stringify(action),
          errorMsg: null,
        })
        .onConflictDoNothing();
    });
  }

  async bindCardMessage(
    actionId: string,
    cardMessageId: string,
  ): Promise<void> {
    const lookup = await this.readCardAction(actionId);
    if (!lookup) throw new Error('待处理卡片不存在');
    await this.db
      .update(operationLog)
      .set({
        result: JSON.stringify({ ...lookup.action, cardMessageId }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operationLog.id, stableUuid(`card-action:${actionId}`)),
          eq(operationLog.status, 'processing'),
        ),
      );
  }

  async claimCardAction(
    actionId: string,
    now: Date = new Date(),
  ): Promise<CardActionClaim> {
    const rows = await this.db
      .update(operationLog)
      .set({ status: 'claimed', updatedAt: now })
      .where(
        and(
          eq(operationLog.id, stableUuid(`card-action:${actionId}`)),
          eq(operationLog.status, 'processing'),
        ),
      )
      .returning({ result: operationLog.result });
    if (rows.length === 0) {
      const existing = await this.readCardAction(actionId);
      return { state: existing ? 'completed' : 'missing' };
    }
    try {
      const action = JSON.parse(rows[0].result) as StoredCardAction;
      if (!action.expiresAt || new Date(action.expiresAt) <= now) {
        await this.completeCardAction(
          actionId,
          'fail',
          'expired',
          '卡片操作已过期',
        );
        return { state: 'expired' };
      }
      return { state: 'claimed', action };
    } catch (error) {
      await this.completeCardAction(
        actionId,
        'fail',
        'invalid',
        error instanceof Error ? error.message : String(error),
      );
      return { state: 'missing' };
    }
  }

  async completeCardAction(
    actionId: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result: string,
    errorMsg: string | null = null,
  ): Promise<void> {
    await this.complete(
      stableUuid(`card-action:${actionId}`),
      status,
      result,
      errorMsg,
    );
  }

  async getCardAction(actionId: string): Promise<StoredCardAction | null> {
    return (await this.readCardAction(actionId))?.action ?? null;
  }

  private async readCardAction(
    actionId: string,
  ): Promise<{ status: string; action: StoredCardAction } | null> {
    const rows = await this.db
      .select({ status: operationLog.status, result: operationLog.result })
      .from(operationLog)
      .where(eq(operationLog.id, stableUuid(`card-action:${actionId}`)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    try {
      return {
        status: row.status,
        action: JSON.parse(row.result) as StoredCardAction,
      };
    } catch {
      return null;
    }
  }

  async claimScheduledRun(kind: 'daily_0900' | 'early_1700', date: string) {
    return this.claim(
      stableUuid(`schedule:${kind}:${date}`),
      kind,
      `${kind}:${date}`,
    );
  }

  async getScheduledRunStatus(
    kind: 'daily_0900' | 'early_1700',
    date: string,
  ): Promise<OperationLogStatus | null> {
    const rows = await this.db
      .select({ status: operationLog.status })
      .from(operationLog)
      .where(eq(operationLog.id, stableUuid(`schedule:${kind}:${date}`)))
      .limit(1);
    return (rows[0]?.status as OperationLogStatus | undefined) ?? null;
  }

  async getHealthIncident(key: string): Promise<HealthIncidentState | null> {
    const rows = await this.db
      .select({ result: operationLog.result })
      .from(operationLog)
      .where(eq(operationLog.id, stableUuid(`health-incident:${key}`)))
      .limit(1);
    if (!rows[0]) return null;
    try {
      return JSON.parse(rows[0].result) as HealthIncidentState;
    } catch {
      return null;
    }
  }

  async saveHealthIncident(key: string, state: HealthIncidentState) {
    await this.db
      .insert(operationLog)
      .values({
        id: stableUuid(`health-incident:${key}`),
        type: 'health_check',
        status: state.active ? 'fail' : 'success',
        content: key,
        result: JSON.stringify(state),
        errorMsg: state.active ? state.message : null,
      })
      .onConflictDoUpdate({
        target: operationLog.id,
        set: {
          status: state.active ? 'fail' : 'success',
          result: JSON.stringify(state),
          errorMsg: state.active ? state.message : null,
          updatedAt: new Date(),
        },
      });
  }

  async recordCreatedEvent(
    messageId: string,
    event: RecentCreatedEvent,
  ): Promise<void> {
    await this.db
      .insert(operationLog)
      .values({
        id: stableUuid(`created:${messageId}`),
        type: 'calendar_created',
        status: 'success',
        content: messageId,
        result: JSON.stringify(event),
      })
      .onConflictDoNothing();
  }

  async getRecentCreatedEvent(
    now: Date = new Date(),
  ): Promise<RecentCreatedEvent | null> {
    const rows = await this.db
      .select({
        result: operationLog.result,
        createdAt: operationLog.createdAt,
      })
      .from(operationLog)
      .where(eq(operationLog.type, 'calendar_created'))
      .orderBy(desc(operationLog.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row || now.getTime() - row.createdAt.getTime() > 24 * 60 * 60 * 1000) {
      return null;
    }
    try {
      return JSON.parse(row.result) as RecentCreatedEvent;
    } catch {
      return null;
    }
  }

  async getCreatedEventById(
    eventId: string,
  ): Promise<RecentCreatedEvent | null> {
    const rows = await this.db
      .select({ result: operationLog.result })
      .from(operationLog)
      .where(eq(operationLog.type, 'calendar_created'))
      .orderBy(desc(operationLog.createdAt))
      .limit(200);
    for (const row of rows) {
      try {
        const event = JSON.parse(row.result) as RecentCreatedEvent;
        if (event.eventId === eventId) return event;
      } catch {
        // Ignore malformed historical rows and continue looking for a valid snapshot.
      }
    }
    return null;
  }

  async finishScheduledRun(
    kind: 'daily_0900' | 'early_1700',
    date: string,
    result: string,
    errorMsg: string | null = null,
  ) {
    await this.complete(
      stableUuid(`schedule:${kind}:${date}`),
      errorMsg ? 'fail' : 'success',
      result,
      errorMsg,
    );
    return { sent: result === 'sent', reason: result };
  }

  private async claim(
    id: string,
    type: OperationLogType,
    content: string,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(operationLog)
      .values({ id, type, status: 'processing', content, result: '' })
      .onConflictDoNothing()
      .returning({ id: operationLog.id });
    return rows.length === 1;
  }

  private async complete(
    id: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result: string,
    errorMsg: string | null = null,
  ) {
    await this.db
      .update(operationLog)
      .set({ status, result, errorMsg, updatedAt: new Date() })
      .where(eq(operationLog.id, id));
  }

  private async retryIdempotentWrite(
    label: string,
    operation: () => Promise<void>,
    attempts = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt === attempts) throw error;
        this.logger.warn(
          `${label}失败，准备第 ${attempt + 1} 次尝试: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }
  }

  private uniqueEventIds(eventIds: unknown): string[] {
    if (!Array.isArray(eventIds)) return [];
    return [
      ...new Set(
        eventIds.filter(
          (eventId): eventId is string =>
            typeof eventId === 'string' && eventId.trim().length > 0,
        ),
      ),
    ];
  }
}
