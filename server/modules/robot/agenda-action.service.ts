import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { FeishuService } from './feishu.service';
import { OperationStoreService, stableUuid } from './operation-store.service';
import { CalendarActionService } from './calendar-action.service';
import { CalendarQueryService } from './calendar-query.service';
import { buildAgendaManageCard } from './agenda-card';
import { buildTerminalCalendarCard } from './interactive-card';
import type { CardRobotInput } from './robot-event';
import type {
  AgendaActionPending,
  CalendarEventSnapshot,
} from './calendar-action.types';
import { EVENT_COLORS } from './schedule-command';

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = 'Asia/Shanghai';

@Injectable()
export class AgendaActionService {
  private readonly logger = new Logger(AgendaActionService.name);

  constructor(
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
    private readonly mutations: CalendarActionService,
    private readonly queries: CalendarQueryService,
  ) {}

  async handle(input: CardRobotInput, now = new Date()) {
    const existing = await this.store.getCardAction(input.actionId);
    if (
      !existing ||
      existing.kind !== 'agenda_action' ||
      existing.actorOpenId !== input.operatorOpenId ||
      existing.chatId !== input.chatId ||
      existing.expectedDecision !== input.decision ||
      (existing.cardMessageId && existing.cardMessageId !== input.messageId)
    ) {
      await this.terminal(
        input.messageId,
        '操作无效',
        '该快捷操作不存在，或不属于当前用户。',
        'failed',
      );
      return;
    }
    const claim = await this.store.claimCardAction(input.actionId, now);
    if (claim.state !== 'claimed' || claim.action.kind !== 'agenda_action') {
      await this.terminal(
        input.messageId,
        '无法执行',
        claim.state === 'expired'
          ? '该操作已过有效期，请重新查询日程。'
          : '该操作已经处理，请勿重复点击。',
        claim.state === 'expired' ? 'expired' : 'failed',
      );
      return;
    }
    const action = claim.action;
    try {
      if (input.decision === 'manage') {
        await this.showManage(input.messageId, action);
      } else if (input.decision === 'back_agenda') {
        await this.queries.replace(input.messageId, action.query);
      } else {
        await this.runQuick(input, action, now);
      }
      await this.store.completeCardAction(
        action.actionId,
        'success',
        input.decision,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.completeCardAction(
        action.actionId,
        'fail',
        'failed',
        message,
      );
      await this.terminal(
        input.messageId,
        '快捷操作失败',
        `${message}。飞书日历未按本次操作变更。`,
        'failed',
      );
    }
  }

  private async showManage(messageId: string, action: AgendaActionPending) {
    if (!action.eventId) throw new Error('日程标识缺失');
    const event = await this.feishu.getCalendarEvent(action.eventId);
    if (!event) throw new Error('目标日程已不存在');
    const decisions = [
      'postpone_hour',
      'tomorrow_10',
      'cancel_event',
      'back_agenda',
    ] as const;
    const actions = Object.fromEntries(
      decisions.map((decision) => [
        decision,
        this.queries.makeAction(
          decision,
          action.query,
          action.sourceMessageId,
          action.eventId,
        ),
      ]),
    ) as Record<(typeof decisions)[number], AgendaActionPending>;
    await Promise.all(
      Object.values(actions).map((item) => this.store.saveCardAction(item)),
    );
    await this.feishu.updateInteractiveCard(
      messageId,
      buildAgendaManageCard({
        event,
        actions: Object.fromEntries(
          Object.entries(actions).map(([key, value]) => [key, value.actionId]),
        ) as Record<(typeof decisions)[number], string>,
      }),
    );
    await Promise.all(
      Object.values(actions).map((item) =>
        this.store.bindCardMessage(item.actionId, messageId),
      ),
    );
  }

  private async runQuick(
    input: CardRobotInput,
    action: AgendaActionPending,
    now: Date,
  ) {
    if (!action.eventId) throw new Error('日程标识缺失');
    const event = await this.feishu.getCalendarEvent(action.eventId);
    if (!event) throw new Error('目标日程已不存在');
    const before = this.mutations.snapshot(event);

    if (input.decision === 'cancel_event') {
      const createdByBot = await this.store.getCreatedEventById(event.eventId);
      await this.mutations.promptMutation(
        { messageId: input.messageId },
        {
          operation: 'cancel',
          eventId: event.eventId,
          before,
          red: (event.color ?? EVENT_COLORS.蓝色) === EVENT_COLORS.红色,
          conflicts: [],
          restorable:
            !!createdByBot && event.attendeeCount === 0 && !event.hasMeeting,
        },
        now,
      );
      return;
    }

    if (event.allDay) {
      throw new Error('全天日程暂不适用按小时快捷移动，请用文字指令修改日期');
    }
    if (event.recurrence || event.recurringEventId) {
      throw new Error('重复日程请用文字指令并说明“仅本次”“本次及后续”或“全部”');
    }

    const after: CalendarEventSnapshot = { ...before };
    const duration = event.endTime.getTime() - event.startTime.getTime();
    if (input.decision === 'postpone_hour') {
      after.startTime = new Date(
        event.startTime.getTime() + 60 * 60 * 1000,
      ).toISOString();
    } else if (input.decision === 'tomorrow_10') {
      after.startTime = dayjs(now)
        .tz(ZONE)
        .add(1, 'day')
        .hour(10)
        .minute(0)
        .second(0)
        .millisecond(0)
        .toDate()
        .toISOString();
    } else {
      throw new Error('未识别快捷操作');
    }
    after.endTime = new Date(
      new Date(after.startTime).getTime() + duration,
    ).toISOString();
    const start = new Date(after.startTime);
    const end = new Date(after.endTime);
    const conflicts = (await this.feishu.listCalendarEvents(start, end)).filter(
      (candidate) =>
        candidate.eventId !== event.eventId &&
        candidate.startTime < end &&
        candidate.endTime > start,
    );
    const draft = {
      operation: 'update' as const,
      eventId: event.eventId,
      before,
      after,
      red: before.colorName === '红色',
      conflicts,
    };
    if (draft.red || conflicts.length > 0) {
      await this.mutations.promptMutation(
        { messageId: input.messageId },
        draft,
        now,
      );
    } else {
      await this.mutations.executeDirect(
        { messageId: input.messageId },
        draft,
        now,
      );
    }
  }

  private async terminal(
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
      this.logger.error(
        `更新快捷操作卡片失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.feishu.replyTextMessage(
        messageId,
        `${title}：${message}`,
        stableUuid(`agenda-terminal:${messageId}:${title}`),
      );
    }
  }
}
