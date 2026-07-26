import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { createHash } from 'crypto';
import { operationLog } from '@server/database/schema';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { FeishuService } from './feishu.service';
import { CalendarCommandService } from './calendar-command.service';
import { ReminderService } from './reminder.service';
import { OperationStoreService, stableUuid } from './operation-store.service';
import { extractRobotInput } from './robot-event';
import { extractCardAction } from './robot-event';
import { CalendarActionService } from './calendar-action.service';
import { AgendaActionService } from './agenda-action.service';
import type {
  HealthCheckResponse,
  OperationLogsResponse,
  EnvCheckResponse,
  FeishuEventResponse,
  ScheduleDailyPushResponse,
  OperationLogType,
  OperationLogStatus,
  DashboardSummaryResponse,
} from '@shared/api.interface';
import type { ChineseScheduleParseOneOutput } from '@shared/plugin-types';

const DEFAULT_BOT_NAME = '日程机器人';

interface ScheduleRequest {
  eventId: string;
  text: string;
}

interface FeishuMention {
  key?: string;
  name?: string;
  id?: { open_id?: string };
}

interface DashboardLogRow {
  status: string;
  result: string;
  errorMsg: string | null;
  createdAt: Date;
}

export function dashboardHealthFromLog(
  key: DashboardSummaryResponse['health'][number]['key'],
  label: string,
  row: DashboardLogRow | undefined,
  waiting: string,
  publicError: (value: string) => string,
): DashboardSummaryResponse['health'][number] {
  if (!row) {
    return {
      key,
      label,
      status: 'unknown',
      desc: waiting,
      lastAt: null,
    };
  }
  const ok = row.status === 'success';
  return {
    key,
    label,
    status: ok ? 'normal' : 'abnormal',
    desc: ok
      ? '最近运行成功'
      : publicError(row.errorMsg || row.result),
    lastAt: row.createdAt.toISOString(),
  };
}

export function dashboardOverall(
  health: DashboardSummaryResponse['health'],
): DashboardSummaryResponse['overall'] {
  if (health.some((item) => item.status === 'abnormal')) return 'attention';
  if (health.some((item) => item.status === 'unknown')) return 'unknown';
  return 'normal';
}

function getChatId(): string {
  return process.env.CHAT_ID || process.env.LARK_CALENDAR_BOT_CHAT_ID || '';
}

function getTargetOpenId(): string {
  return (
    process.env.TARGET_OPEN_ID ||
    process.env.LARK_CALENDAR_BOT_OWNER_OPEN_ID ||
    ''
  );
}

function getBotOpenId(): string {
  return process.env.BOT_OPEN_ID || '';
}

function getBotName(): string {
  return process.env.BOT_NAME || DEFAULT_BOT_NAME;
}

export function eventIdToUuid(eventId: string): string {
  const hash = createHash('sha256').update(eventId).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

export function isPendingOperationActive(result: string, now: Date): boolean {
  try {
    const parsed = JSON.parse(result) as { expiresAt?: string };
    if (!parsed.expiresAt) return false;
    const expiresAt = new Date(parsed.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now.getTime();
  } catch {
    return false;
  }
}

export function getMissingScheduleFields(
  parsed: ChineseScheduleParseOneOutput,
): string[] {
  const missing: string[] = [];
  if (!parsed.title?.trim()) missing.push('事项');
  return missing;
}

export function extractScheduleRequest(
  body: Record<string, unknown>,
  botOpenId: string,
  botName: string,
): ScheduleRequest | null {
  const header = body.header as Record<string, unknown> | undefined;
  if (header?.event_type !== 'im.message.receive_v1') return null;

  const event = body.event as Record<string, unknown> | undefined;
  const message = event?.message as Record<string, unknown> | undefined;
  if (
    !message ||
    message.chat_type !== 'group' ||
    message.message_type !== 'text'
  ) {
    return null;
  }

  const mentions = Array.isArray(message.mentions)
    ? (message.mentions as FeishuMention[])
    : [];
  const botMention = mentions.find((mention) => {
    if (botOpenId && mention.id?.open_id === botOpenId) return true;
    return !!botName && mention.name === botName;
  });
  if (!botMention) return null;

  try {
    const content = JSON.parse(String(message.content ?? '')) as {
      text?: string;
    };
    const mentionKey = botMention.key ?? '';
    const text = (content.text ?? '').replace(mentionKey, '').trim();
    // 飞书可能重复推送同一条消息；官方建议按 message_id 去重，
    // event_id 仅在没有 message_id 的兼容场景下兜底。
    const eventId = String(message.message_id || header.event_id || '');
    if (!text || !eventId) return null;
    return { eventId, text };
  } catch {
    return null;
  }
}

@Injectable()
export class RobotService {
  private readonly logger = new Logger(RobotService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly feishuService: FeishuService,
    private readonly calendarCommands: CalendarCommandService,
    private readonly reminderService: ReminderService,
    private readonly operationStore: OperationStoreService,
    private readonly calendarActions: CalendarActionService,
    @Optional() private readonly agendaActions?: AgendaActionService,
  ) {}

  async checkHealth(): Promise<HealthCheckResponse> {
    const feishuConfigured = this.feishuService.isConfigured();
    const [calendarResult, latestMessage, latestSchedule] = await Promise.all([
      feishuConfigured
        ? this.feishuService.checkCalendarPermission()
        : Promise.resolve({ ok: false, message: '飞书凭证未配置' }),
      this.getLatestOperation('message_process'),
      this.getLatestOperation('daily_0900'),
    ]);

    const messageHealthy =
      feishuConfigured && latestMessage?.status === 'success';
    const scheduleHealthy = latestSchedule?.status === 'success';

    return {
      messageListen: {
        status: messageHealthy ? 'normal' : 'abnormal',
        desc: !feishuConfigured
          ? '飞书凭证未配置'
          : latestMessage?.status === 'fail'
            ? `最近消息处理失败：${latestMessage.errorMsg || latestMessage.result}`
            : latestMessage?.status === 'processing'
              ? '最近消息正在处理'
              : latestMessage
                ? '消息监听正常'
                : '等待首次有效 @消息',
      },
      scheduleTask: {
        status: scheduleHealthy ? 'normal' : 'abnormal',
        desc:
          latestSchedule?.status === 'fail'
            ? `最近九点汇总失败：${latestSchedule.errorMsg || latestSchedule.result}`
            : latestSchedule
              ? '每日09:00汇总运行正常'
              : '等待首次09:00汇总执行',
      },
      calendarPermission: {
        status: calendarResult.ok ? 'normal' : 'abnormal',
        desc: calendarResult.message,
      },
    };
  }

  async getOperationLogs(
    page: number,
    pageSize: number,
  ): Promise<OperationLogsResponse> {
    const offset = (page - 1) * pageSize;
    const items = await this.db
      .select({
        id: operationLog.id,
        type: operationLog.type,
        status: operationLog.status,
        content: operationLog.content,
        result: operationLog.result,
        errorMsg: operationLog.errorMsg,
        createdAt: operationLog.createdAt,
      })
      .from(operationLog)
      .orderBy(desc(operationLog.createdAt))
      .limit(pageSize)
      .offset(offset);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(operationLog);

    return {
      items: items.map((item) => ({
        ...item,
        type: item.type as OperationLogType,
        status: item.status as OperationLogStatus,
        createdAt: item.createdAt.toISOString(),
      })),
      total: countResult[0]?.count ?? 0,
    };
  }

  async checkEnv(): Promise<EnvCheckResponse> {
    return {
      variables: [
        { key: 'APP_ID', exists: this.feishuService.hasAppId(), masked: true },
        {
          key: 'APP_SECRET',
          exists: this.feishuService.hasAppSecret(),
          masked: true,
        },
        { key: 'CHAT_ID', exists: !!getChatId(), masked: false },
        {
          key: 'TARGET_OPEN_ID',
          exists: !!getTargetOpenId(),
          masked: false,
        },
        {
          key: 'TARGET_CALENDAR_ID',
          exists: this.feishuService.hasTargetCalendar(),
          masked: false,
        },
        { key: 'BOT_OPEN_ID', exists: !!getBotOpenId(), masked: false },
        {
          key: 'VERIFICATION_TOKEN',
          exists: this.feishuService.hasVerificationToken(),
          masked: true,
        },
        {
          key: 'ENCRYPT_KEY',
          exists: this.feishuService.hasEncryptKey(),
          masked: true,
        },
      ],
    };
  }

  async getDashboardSummary(
    now = new Date(),
  ): Promise<DashboardSummaryResponse> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [calendarResult, rows] = await Promise.all([
      this.feishuService.isConfigured()
        ? this.feishuService.checkCalendarPermission()
        : Promise.resolve({ ok: false, message: '飞书凭证未配置' }),
      this.db
        .select({
          id: operationLog.id,
          type: operationLog.type,
          status: operationLog.status,
          result: operationLog.result,
          errorMsg: operationLog.errorMsg,
          createdAt: operationLog.createdAt,
        })
        .from(operationLog)
        .where(gte(operationLog.createdAt, since))
        .orderBy(desc(operationLog.createdAt))
        .limit(500),
    ]);
    const latest = (types: OperationLogType[]) =>
      rows.find((row) => types.includes(row.type as OperationLogType));
    const healthFromLog = (
      key: DashboardSummaryResponse['health'][number]['key'],
      label: string,
      types: OperationLogType[],
      waiting: string,
    ): DashboardSummaryResponse['health'][number] =>
      dashboardHealthFromLog(
        key,
        label,
        latest(types),
        waiting,
        (value) => this.publicDashboardError(value),
      );
    const health: DashboardSummaryResponse['health'] = [
      healthFromLog(
        'message',
        '消息监听',
        ['message_process'],
        '等待有效 @消息',
      ),
      {
        key: 'calendar',
        label: '日历读写',
        status: calendarResult.ok ? 'normal' : 'abnormal',
        desc: this.publicDashboardError(calendarResult.message),
        lastAt: now.toISOString(),
      },
      healthFromLog('card', '卡片回调', ['card_action'], '等待首次按钮操作'),
      healthFromLog(
        'daily0900',
        '09:00 汇总',
        ['daily_0900'],
        '等待首次定时执行',
      ),
      healthFromLog(
        'early1700',
        '17:00 提醒',
        ['early_1700'],
        '等待首次定时执行',
      ),
    ];
    const pendingTypes: OperationLogType[] = [
      'calendar_action',
      'calendar_undo',
      'pending_action',
    ];
    const pending = rows.filter(
      (row) =>
        pendingTypes.includes(row.type as OperationLogType) &&
        ['processing', 'claimed'].includes(row.status) &&
        isPendingOperationActive(row.result, now),
    ).length;
    const recent = rows.slice(0, 30).map((row) => {
      let summary = this.dashboardOperationSummary(
        row.type as OperationLogType,
        row.result,
      );
      let expiresAt: string | null = null;
      if (pendingTypes.includes(row.type as OperationLogType)) {
        try {
          const parsed = JSON.parse(row.result) as { expiresAt?: string };
          expiresAt = parsed.expiresAt || null;
        } catch {
          expiresAt = null;
        }
      }
      return {
        id: row.id,
        type: row.type as OperationLogType,
        status: row.status as OperationLogStatus,
        summary,
        createdAt: row.createdAt.toISOString(),
        expiresAt,
      };
    });
    return {
      overall: dashboardOverall(health),
      checkedAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      version:
        process.env.APP_VERSION || process.env.npm_package_version || '1.1.0',
      stats: {
        processed: rows.length,
        success: rows.filter((row) => row.status === 'success').length,
        failed: rows.filter((row) => row.status === 'fail').length,
        pending,
      },
      health,
      recent,
    };
  }

  private dashboardOperationSummary(
    type: OperationLogType,
    result: string,
  ): string {
    const labels: Record<OperationLogType, string> = {
      message_process: '文字消息处理',
      pending_action: '候选操作待处理',
      calendar_action: '日程确认待处理',
      agenda_action: '日程快捷操作',
      calendar_undo: '一键撤销待处理',
      card_action: '卡片按钮处理',
      calendar_created: '日程已创建',
      calendar_card_reference: '卡片日程引用',
      schedule_push: '日程提醒推送',
      daily_0900: '09:00 日程汇总',
      early_1700: '17:00 次日提醒',
      health_check: '健康检查',
    };
    try {
      const parsed = JSON.parse(result) as {
        operation?: string;
        after?: { summary?: string };
        before?: { summary?: string };
        event?: { summary?: string };
        summary?: string;
      };
      const subject =
        parsed.after?.summary ||
        parsed.before?.summary ||
        parsed.event?.summary ||
        parsed.summary;
      return subject
        ? `${labels[type]}｜${String(subject).slice(0, 80)}`
        : labels[type];
    } catch {
      return labels[type];
    }
  }

  private publicDashboardError(value: string): string {
    return (value || '状态异常')
      .replace(/https?:\/\/\S+/g, '[链接已隐藏]')
      .replace(/(token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[已隐藏]')
      .replace(/\b(?:ou|oc)_[A-Za-z0-9_-]+\b/g, '[标识已隐藏]')
      .slice(0, 160);
  }

  async handleFeishuEvent(
    body: Record<string, unknown>,
  ): Promise<FeishuEventResponse> {
    const input = extractRobotInput(body, {
      chatId: getChatId(),
      senderOpenId: getTargetOpenId(),
      botOpenId: getBotOpenId(),
      botName: getBotName(),
    });
    if (!input) return { code: 0, msg: 'ignored' };
    let claimed: boolean;
    try {
      claimed = await this.operationStore.claimMessage(
        input.messageId,
        input.kind,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`登记飞书消息失败: ${errorMessage}`);
      await this.safeReplyFailure(input.messageId, errorMessage);
      return { code: 0, msg: 'handled with feedback' };
    }
    if (!claimed) {
      return { code: 0, msg: 'duplicate' };
    }
    try {
      if (input.parentId) {
        const pending = await this.operationStore.getPending(input.parentId);
        if (pending.state === 'pending') {
          if (pending.action.kind === 'calendar_cancel') {
            await this.calendarCommands.confirmCancellation(
              input,
              pending.action,
            );
          } else if (pending.action.kind === 'calendar_cancel_selection') {
            await this.calendarCommands.selectCancellations(
              input,
              pending.action,
            );
          } else if (pending.action.kind === 'calendar_update_selection') {
            await this.calendarCommands.selectUpdateCandidate(
              input,
              pending.action,
            );
          }
        } else if (pending.state === 'completed') {
          await this.feishuService.replyTextMessage(
            input.messageId,
            '该确认事项已经处理，请勿重复提交。',
            stableUuid(`reply:${input.messageId}:completed`),
          );
        } else if (/^(确认|确认取消|取消)[。！!]?$/.test(input.text.trim())) {
          await this.feishuService.replyTextMessage(
            input.messageId,
            '未找到有效的待确认记录，可能已经超过24小时。请重新发起日程操作。',
            stableUuid(`reply:${input.messageId}:expired`),
          );
        } else {
          await this.calendarCommands.handleText(input);
        }
      } else {
        await this.calendarCommands.handleText(input);
      }
      await this.safeCompleteMessage(input.messageId, 'success', 'handled');
      return { code: 0, msg: 'ok' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`处理飞书事件失败: ${errorMessage}`);
      await this.safeReplyFailure(input.messageId, errorMessage);
      await this.safeCompleteMessage(
        input.messageId,
        'fail',
        'failed',
        errorMessage,
      );
      return { code: 0, msg: 'handled with feedback' };
    }
  }

  async handleFeishuCardAction(body: Record<string, unknown>): Promise<void> {
    const input = extractCardAction(body, {
      chatId: getChatId(),
      senderOpenId: getTargetOpenId(),
      botOpenId: getBotOpenId(),
      botName: getBotName(),
    });
    if (!input) return;
    let claimed = false;
    try {
      claimed = await this.operationStore.claimCardCallback(input.callbackId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`保存卡片回调失败: ${message}`);
      try {
        await this.feishuService.replyTextMessage(
          input.messageId,
          '操作失败：系统暂时无法保存本次按钮操作，飞书日历未发生变更，请稍后重试。',
          stableUuid(`card-callback-failed:${input.callbackId}`),
        );
      } catch (replyError) {
        this.logger.error(
          `发送卡片失败反馈失败: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
        );
      }
      return;
    }
    if (!claimed) return;
    try {
      if (['search_two_years', 'cancel_search'].includes(input.decision)) {
        await this.calendarCommands.handleSearchExpansionAction(input);
      } else if (
        [
          'manage',
          'postpone_hour',
          'tomorrow_10',
          'cancel_event',
          'back_agenda',
        ].includes(input.decision)
      ) {
        if (!this.agendaActions) throw new Error('快捷操作服务未就绪');
        await this.agendaActions.handle(input);
      } else {
        await this.calendarActions.handleCardAction(input);
      }
      try {
        await this.operationStore.completeCardCallback(
          input.callbackId,
          'success',
          input.decision,
        );
      } catch (error) {
        this.logger.error(
          `卡片已处理但回调记录保存失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`处理卡片按钮失败: ${message}`);
      try {
        await this.operationStore.completeCardCallback(
          input.callbackId,
          'fail',
          'failed',
          message,
        );
      } catch (storeError) {
        this.logger.error(
          `保存卡片失败结果失败: ${storeError instanceof Error ? storeError.message : String(storeError)}`,
        );
      }
      try {
        await this.feishuService.replyTextMessage(
          input.messageId,
          '按钮操作未能完整完成，飞书日历可能已经发生变更。请先查看日历中的实际结果，再决定是否重试，避免重复创建、修改或删除。',
          stableUuid(`card-action-failed:${input.callbackId}`),
        );
      } catch (replyError) {
        this.logger.error(
          `发送卡片执行失败反馈失败: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
        );
      }
    }
  }

  private async safeReplyFailure(messageId: string, errorMessage: string) {
    try {
      const userMessage = errorMessage.startsWith('Failed query:')
        ? '指令内容已识别，但系统暂时无法保存确认操作，飞书日历未发生变更，请重新发送刚才的指令'
        : errorMessage;
      await this.feishuService.replyTextMessage(
        messageId,
        `处理失败：${userMessage}\n请稍后重试；如仍失败，请发送“@日程机器人 帮助”。`,
        stableUuid(`reply:${messageId}:final-error`),
      );
    } catch (sendError) {
      this.logger.error(
        `发送错误回复失败: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
      );
    }
  }

  private async safeCompleteMessage(
    messageId: string,
    status: Extract<OperationLogStatus, 'success' | 'fail'>,
    result: string,
    errorMsg: string | null = null,
  ) {
    try {
      if (errorMsg === null) {
        await this.operationStore.completeMessage(messageId, status, result);
      } else {
        await this.operationStore.completeMessage(
          messageId,
          status,
          result,
          errorMsg,
        );
      }
    } catch (error) {
      this.logger.error(
        `更新消息处理状态失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async dailyPush(): Promise<ScheduleDailyPushResponse> {
    const result = await this.reminderService.pushToday();
    return {
      success: ['sent', 'silent', 'duplicate'].includes(result.reason),
      msg: result.reason,
    };
  }

  private async logOperation(
    type: OperationLogType,
    status: OperationLogStatus,
    content: string,
    result: string,
    errorMsg: string | null,
    id?: string,
  ): Promise<void> {
    try {
      await this.db
        .insert(operationLog)
        .values({
          ...(id ? { id } : {}),
          type,
          status,
          content,
          result,
          errorMsg,
        })
        .onConflictDoNothing();
    } catch (error) {
      this.logger.error(
        `写入操作日志失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getLatestOperation(type: OperationLogType): Promise<{
    status: OperationLogStatus;
    result: string;
    errorMsg: string | null;
  } | null> {
    try {
      const rows = await this.db
        .select({
          status: operationLog.status,
          result: operationLog.result,
          errorMsg: operationLog.errorMsg,
        })
        .from(operationLog)
        .where(eq(operationLog.type, type))
        .orderBy(desc(operationLog.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? { ...row, status: row.status as OperationLogStatus } : null;
    } catch (error) {
      this.logger.error(
        `读取健康日志失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
