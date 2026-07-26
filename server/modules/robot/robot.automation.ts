import { Logger } from '@nestjs/common';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { RobotService } from './robot.service';
import { FeishuService } from './feishu.service';
import { ReminderService } from './reminder.service';

interface WebhookEvent {
  method: string;
  body: string | Record<string, unknown>;
  headers: Record<string, string[]>;
}

interface TaskHandlerArgs {
  attributes: {
    trigger: string;
    triggerType: string;
    instanceID: string;
  };
  content: {
    input: string;
  };
}

@Automation()
export class RobotAutomationService {
  private readonly logger = new Logger(RobotAutomationService.name);

  constructor(
    private readonly robotService: RobotService,
    private readonly feishuService: FeishuService,
    private readonly reminderService: ReminderService,
  ) {}

  @BindTrigger('daily_schedule_push')
  async dailySchedulePush(): Promise<string> {
    this.logger.log('定时任务触发：每日09:00日程汇总');
    const result = await this.reminderService.pushToday();
    this.logger.log(`定时任务完成: ${result.reason}`);
    return result.reason;
  }

  @BindTrigger('next_day_early_reminder')
  async nextDayEarlyReminder(): Promise<string> {
    this.logger.log('定时任务触发：每日17:00次日早间提醒');
    const result = await this.reminderService.pushTomorrowEarly();
    this.logger.log(`定时任务完成: ${result.reason}`);
    return result.reason;
  }

  @BindTrigger('feishu_event_receive')
  async handleFeishuWebhook(event: TaskHandlerArgs): Promise<string> {
    this.logger.log('Webhook 触发：接收飞书事件');

    const input = event.content.input;
    if (typeof input !== 'string') {
      this.logger.error('input 类型错误');
      return 'error: invalid input';
    }

    let webhookEvent: WebhookEvent;
    try {
      webhookEvent = JSON.parse(input);
    } catch {
      this.logger.error('JSON 解析失败');
      return 'error: parse failed';
    }

    let body: Record<string, unknown>;
    try {
      body =
        typeof webhookEvent.body === 'string'
          ? (JSON.parse(webhookEvent.body) as Record<string, unknown>)
          : webhookEvent.body;
    } catch {
      this.logger.error('body 解析失败');
      return 'error: body parse failed';
    }

    if (body.challenge) {
      this.logger.log('收到 challenge 验证请求');
      return JSON.stringify({ challenge: body.challenge });
    }

    const decryptedBody = this.getDecryptedBody(body);
    if (decryptedBody?.challenge) {
      this.logger.log('收到加密 challenge 验证请求');
      return JSON.stringify({ challenge: decryptedBody.challenge });
    }

    const eventBody = decryptedBody ?? body;
    const rawBody = Buffer.from(
      typeof webhookEvent.body === 'string'
        ? webhookEvent.body
        : JSON.stringify(webhookEvent.body),
    );
    if (
      !this.feishuService.isEventAuthorized(
        webhookEvent.headers,
        rawBody,
        eventBody,
      )
    ) {
      this.logger.warn('飞书事件来源校验失败');
      return JSON.stringify({ code: -1, msg: '事件来源校验失败' });
    }

    const result = await this.robotService.handleFeishuEvent(eventBody);
    return JSON.stringify(result);
  }

  private getDecryptedBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const encrypt = body.encrypt as string | undefined;
    if (!encrypt) return null;
    return this.feishuService.decryptEventBody(encrypt);
  }
}
