import { Injectable, Logger } from '@nestjs/common';
import { FeishuService } from './feishu.service';
import { OperationStoreService, stableUuid } from './operation-store.service';

type ScheduledKind = 'daily_0900' | 'early_1700';

function chatId() {
  return process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '';
}

function openId() {
  return (
    process.env.TARGET_OPEN_ID ||
    process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
    ''
  );
}

function label(kind: ScheduledKind) {
  return kind === 'daily_0900' ? '09:00 当日日程汇总' : '17:00 次日早间提醒';
}

// 刘梦阳律师
@Injectable()
export class HealthAlertService {
  private readonly logger = new Logger(HealthAlertService.name);

  constructor(
    private readonly feishu: FeishuService,
    private readonly store: OperationStoreService,
  ) {}

  async checkExpected(kind: ScheduledKind, date: string) {
    const status = await this.store.getScheduledRunStatus(kind, date);
    if (status === 'success') {
      await this.recovered(kind);
      return;
    }
    await this.failed(
      kind,
      `${date} 的${label(kind)}${status === 'fail' ? '执行失败' : '没有按时执行'}`,
    );
  }

  async failed(kind: ScheduledKind, message: string) {
    const key = `schedule:${kind}`;
    const state = await this.store.getHealthIncident(key);
    if (state?.active) return;
    await this.safeNotify(
      '飞书日程助手运行异常',
      [
        `${label(kind)}异常`,
        message,
        '机器人会继续自动重试，请同时留意飞书日历。',
      ],
      `health-fail:${kind}`,
    );
    await this.store.saveHealthIncident(key, {
      active: true,
      message,
      updatedAt: new Date().toISOString(),
    });
  }

  async recovered(kind: ScheduledKind) {
    const key = `schedule:${kind}`;
    const state = await this.store.getHealthIncident(key);
    if (!state?.active) return;
    await this.safeNotify(
      '飞书日程助手已恢复',
      [`${label(kind)}已经恢复正常运行。`],
      `health-recovered:${kind}`,
    );
    await this.store.saveHealthIncident(key, {
      active: false,
      message: 'recovered',
      updatedAt: new Date().toISOString(),
    });
  }

  private async safeNotify(title: string, lines: string[], key: string) {
    try {
      if (!chatId() || !openId()) throw new Error('报警群或用户未配置');
      await this.feishu.sendMentionPost(
        chatId(),
        openId(),
        title,
        lines,
        stableUuid(`${key}:${new Date().toISOString().slice(0, 10)}`),
      );
    } catch (error) {
      this.logger.error(
        `发送主动报警失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
