import { Injectable, Optional } from '@nestjs/common';
import { FeishuService, type CalendarEventRecord } from './feishu.service';
import { OperationStoreService, stableUuid } from './operation-store.service';
import {
  getShanghaiDayRangeDates,
  getTomorrowEarlyRange,
} from './schedule-time';
import { CalendarQueryService } from './calendar-query.service';
import { HealthAlertService } from './health-alert.service';

function getChatId() {
  return process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '';
}

function getTargetOpenId() {
  return (
    process.env.TARGET_OPEN_ID ||
    process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
    ''
  );
}

export interface ReminderResult {
  sent: boolean;
  reason: string;
}

// 刘梦阳律师
@Injectable()
export class ReminderService {
  constructor(
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
    @Optional() private readonly queries?: CalendarQueryService,
    @Optional() private readonly alerts?: HealthAlertService,
  ) {}

  async pushToday(reference = new Date()): Promise<ReminderResult> {
    const dateKey = this.dateKey(reference);
    await this.safeAlert(() =>
      this.alerts?.checkExpected(
        'early_1700',
        this.dateKey(new Date(reference.getTime() - 24 * 60 * 60 * 1000)),
      ),
    );
    if (!(await this.store.claimScheduledRun('daily_0900', dateKey))) {
      return { sent: false, reason: 'duplicate' };
    }
    try {
      const range = getShanghaiDayRangeDates(reference);
      const events = await this.feishu.listCalendarEvents(
        range.start,
        range.end,
      );
      if (events.length === 0) {
        await this.feishu.sendTextMessage(
          this.requiredChatId(),
          '今天暂无安排，要不休息下吧～',
          stableUuid(`daily-empty:${dateKey}`),
        );
        const result = await this.store.finishScheduledRun(
          'daily_0900',
          dateKey,
          'sent',
        );
        await this.safeAlert(() => this.alerts?.recovered('daily_0900'));
        return result;
      }
      if (this.queries) {
        await this.queries.push(
          this.requiredChatId(),
          { start: range.start, end: range.end, label: '今日日程' },
          events,
          '今日日程',
          this.requiredTargetOpenId(),
          stableUuid(`daily:${dateKey}`),
        );
      } else {
        await this.feishu.sendMentionPost(
          this.requiredChatId(),
          this.requiredTargetOpenId(),
          '今日日程',
          this.formatAgenda(events),
          stableUuid(`daily:${dateKey}`),
        );
      }
      const result = await this.store.finishScheduledRun(
        'daily_0900',
        dateKey,
        'sent',
      );
      await this.safeAlert(() => this.alerts?.recovered('daily_0900'));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.store.finishScheduledRun(
          'daily_0900',
          dateKey,
          'fail',
          message,
        );
      } catch {
        // 报警不得因日志写入失败而被跳过。
      }
      await this.safeAlert(() => this.alerts?.failed('daily_0900', message));
      return { sent: false, reason: message };
    }
  }

  async pushTomorrowEarly(reference = new Date()): Promise<ReminderResult> {
    const dateKey = this.dateKey(reference);
    await this.safeAlert(() =>
      this.alerts?.checkExpected('daily_0900', dateKey),
    );
    if (!(await this.store.claimScheduledRun('early_1700', dateKey))) {
      return { sent: false, reason: 'duplicate' };
    }
    try {
      const range = getTomorrowEarlyRange(reference, 9, 30);
      const queryEnd = new Date(range.endInclusive.getTime() + 1000);
      const events = (
        await this.feishu.listCalendarEvents(range.start, queryEnd)
      ).filter(
        (event) => event.allDay || event.startTime <= range.endInclusive,
      );
      if (events.length === 0) {
        const result = await this.store.finishScheduledRun(
          'early_1700',
          dateKey,
          'silent',
        );
        await this.safeAlert(() => this.alerts?.recovered('early_1700'));
        return result;
      }
      if (this.queries) {
        await this.queries.push(
          this.requiredChatId(),
          { start: range.start, end: queryEnd, label: '次日 09:30 前日程' },
          events,
          '次日早间日程提醒',
          this.requiredTargetOpenId(),
          stableUuid(`early:${dateKey}`),
        );
      } else {
        await this.feishu.sendMentionPost(
          this.requiredChatId(),
          this.requiredTargetOpenId(),
          '次日早间日程提醒',
          this.formatAgenda(events),
          stableUuid(`early:${dateKey}`),
        );
      }
      const result = await this.store.finishScheduledRun(
        'early_1700',
        dateKey,
        'sent',
      );
      await this.safeAlert(() => this.alerts?.recovered('early_1700'));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.store.finishScheduledRun(
          'early_1700',
          dateKey,
          'fail',
          message,
        );
      } catch {
        // 报警不得因日志写入失败而被跳过。
      }
      await this.safeAlert(() => this.alerts?.failed('early_1700', message));
      return { sent: false, reason: message };
    }
  }

  private formatAgenda(events: CalendarEventRecord[]) {
    return [...events]
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.startTime.getTime() - b.startTime.getTime();
      })
      .map((event, index) => {
        const time = event.allDay
          ? '全天'
          : `${this.formatTime(event.startTime)}-${this.formatTime(event.endTime)}`;
        return `${index + 1}. ${time}｜${event.summary}${event.location ? `｜${event.location}` : ''}`;
      });
  }

  private formatTime(date: Date) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private dateKey(date: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private requiredChatId() {
    const value = getChatId();
    if (!value) throw new Error('CHAT_ID 未配置');
    return value;
  }

  private requiredTargetOpenId() {
    const value = getTargetOpenId();
    if (!value) throw new Error('TARGET_OPEN_ID 未配置');
    return value;
  }

  private async safeAlert(operation: () => Promise<unknown> | undefined) {
    try {
      await operation();
    } catch {
      // 主动报警是旁路能力，不阻断日程提醒本身。
    }
  }

}
