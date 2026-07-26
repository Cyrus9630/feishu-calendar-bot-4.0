import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import * as lark from '@larksuiteoapi/node-sdk';
import { getShanghaiDayRange } from './schedule-time';

function getAppId(): string {
  return (
    process.env.FEISHU_APP_ID ||
    process.env.LARK_CALENDAR_BOT_APP_ID ||
    process.env.APP_ID ||
    ''
  );
}

function getAppSecret(): string {
  return process.env.FEISHU_APP_SECRET || process.env.APP_SECRET || '';
}

function getVerificationToken(): string {
  return (
    process.env.FEISHU_VERIFICATION_TOKEN ||
    process.env.VERIFICATION_TOKEN ||
    ''
  );
}

function getEncryptKey(): string {
  return process.env.FEISHU_ENCRYPT_KEY || process.env.ENCRYPT_KEY || '';
}

function getCalendarId(): string {
  return process.env.TARGET_CALENDAR_ID || 'primary';
}

export interface CalendarEventInfo {
  summary: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  location?: string;
  color?: number;
  reminders?: number[];
  recurrence?: string;
  allDay?: boolean;
}

export interface CalendarEventRecord extends CalendarEventInfo {
  eventId: string;
  recurringEventId?: string;
  isException?: boolean;
  appLink?: string;
  allDay: boolean;
  status?: string;
  attendeeCount: number;
  hasMeeting: boolean;
}

@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);
  private client: lark.Client | null = null;

  isConfigured(): boolean {
    const appId = getAppId();
    const appSecret = getAppSecret();
    return appId !== '' && appSecret !== '';
  }

  hasAppId(): boolean {
    return getAppId() !== '';
  }

  hasAppSecret(): boolean {
    return getAppSecret() !== '';
  }

  hasVerificationToken(): boolean {
    return getVerificationToken() !== '';
  }

  hasEncryptKey(): boolean {
    return getEncryptKey() !== '';
  }

  hasTargetCalendar(): boolean {
    return (process.env.TARGET_CALENDAR_ID || '') !== '';
  }

  verifyRequestSignature(
    headers:
      IncomingHttpHeaders | Record<string, string | string[] | undefined>,
    rawBody?: Buffer,
  ): boolean {
    const timestamp = this.getHeader(headers, 'x-lark-request-timestamp');
    const nonce = this.getHeader(headers, 'x-lark-request-nonce');
    const signature = this.getHeader(headers, 'x-lark-signature');
    if (!timestamp || !nonce || !signature || !rawBody) return false;
    return this.verifySignature(timestamp, nonce, rawBody, signature);
  }

  verifySignature(
    timestamp: string,
    nonce: string,
    rawBody: Buffer,
    signature: string,
  ): boolean {
    const encryptKey = getEncryptKey();
    if (!encryptKey) return false;
    const computed = crypto
      .createHash('sha256')
      .update(
        Buffer.concat([
          Buffer.from(timestamp + nonce + encryptKey, 'utf8'),
          rawBody,
        ]),
      )
      .digest('hex');
    const computedBuffer = Buffer.from(computed, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    return (
      computedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(computedBuffer, signatureBuffer)
    );
  }

  isEventAuthorized(
    headers:
      IncomingHttpHeaders | Record<string, string | string[] | undefined>,
    rawBody: Buffer | undefined,
    eventBody: Record<string, unknown>,
  ): boolean {
    return (
      this.verifyRequestSignature(headers, rawBody) ||
      this.checkVerificationToken(eventBody)
    );
  }

  checkVerificationToken(body: Record<string, unknown>): boolean {
    const expectedToken = getVerificationToken();
    if (!expectedToken) return false;
    const topLevelToken = body.token as string | undefined;
    if (topLevelToken) return topLevelToken === expectedToken;
    const header = body.header as Record<string, unknown> | undefined;
    const token = header?.token as string | undefined;
    return token === expectedToken;
  }

  decryptEventBody(encrypt: string): Record<string, unknown> {
    const encryptKey = getEncryptKey();
    if (!encryptKey) throw new Error('飞书 Encrypt Key 未配置');

    const key = crypto.createHash('sha256').update(encryptKey).digest();
    const encryptedBuffer = Buffer.from(encrypt, 'base64');
    const iv = encryptedBuffer.subarray(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer.subarray(16)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decrypted) as Record<string, unknown>;
  }

  private getClient(): lark.Client {
    if (this.client) return this.client;
    const appId = getAppId();
    const appSecret = getAppSecret();
    if (!appId || !appSecret) {
      throw new Error('飞书凭证未配置：需要 APP_ID 和 APP_SECRET 环境变量');
    }
    this.client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });
    return this.client;
  }

  async createCalendarEvent(
    event: CalendarEventInfo,
    idempotencyKey: string,
  ): Promise<string> {
    const client = this.getClient();
    const res = await client.calendar.calendarEvent.create({
      path: { calendar_id: getCalendarId() },
      params: { idempotency_key: idempotencyKey },
      data: {
        summary: event.summary,
        ...(event.description ? { description: event.description } : {}),
        start_time: event.allDay
          ? { date: this.formatShanghaiDate(event.startTime) }
          : {
              timestamp: String(Math.floor(event.startTime.getTime() / 1000)),
              timezone: 'Asia/Shanghai',
            },
        end_time: event.allDay
          ? { date: this.formatShanghaiDate(event.endTime) }
          : {
              timestamp: String(Math.floor(event.endTime.getTime() / 1000)),
              timezone: 'Asia/Shanghai',
            },
        attendee_ability: 'can_invite_others',
        ...(event.location ? { location: { name: event.location } } : {}),
        ...(typeof event.color === 'number' ? { color: event.color } : {}),
        ...(event.reminders
          ? { reminders: event.reminders.map((minutes) => ({ minutes })) }
          : {}),
        ...(event.recurrence ? { recurrence: event.recurrence } : {}),
      },
    });
    if (res.code !== 0) {
      throw new Error(`创建日程失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.event?.event_id ?? '';
  }

  async patchCalendarEvent(
    eventId: string,
    patch: Partial<CalendarEventInfo>,
  ): Promise<void> {
    try {
      const res = await this.getClient().calendar.calendarEvent.patch({
        path: { calendar_id: getCalendarId(), event_id: eventId },
        data: {
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
          ...(patch.startTime
            ? {
                start_time: patch.allDay
                  ? { date: this.formatShanghaiDate(patch.startTime) }
                  : {
                      timestamp: String(
                        Math.floor(patch.startTime.getTime() / 1000),
                      ),
                      timezone: 'Asia/Shanghai',
                    },
              }
            : {}),
          ...(patch.endTime
            ? {
                end_time: patch.allDay
                  ? { date: this.formatShanghaiDate(patch.endTime) }
                  : {
                      timestamp: String(
                        Math.floor(patch.endTime.getTime() / 1000),
                      ),
                      timezone: 'Asia/Shanghai',
                    },
              }
            : {}),
          ...(patch.location !== undefined
            ? { location: { name: patch.location } }
            : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.reminders !== undefined
            ? {
                reminders: patch.reminders.map((minutes) => ({ minutes })),
              }
            : {}),
          ...(patch.recurrence !== undefined
            ? { recurrence: patch.recurrence }
            : {}),
        },
      });
      if (res.code !== 0) {
        throw new Error(`修改日程失败 [${res.code}]: ${res.msg}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('修改日程失败')) {
        throw error;
      }
      throw new Error(`修改日程失败：${this.formatApiError(error)}`);
    }
  }

  async deleteCalendarEvent(eventId: string): Promise<void> {
    const res = await this.getClient().calendar.calendarEvent.delete({
      path: { calendar_id: getCalendarId(), event_id: eventId },
      params: { need_notification: 'true' },
    });
    if (res.code !== 0) {
      throw new Error(`取消日程失败 [${res.code}]: ${res.msg}`);
    }
  }

  async addAttendee(eventId: string, openId: string): Promise<void> {
    const client = this.getClient();
    const res = await client.calendar.calendarEventAttendee.create({
      path: { calendar_id: getCalendarId(), event_id: eventId },
      data: {
        attendees: [{ type: 'user', user_id: openId }],
        need_notification: true,
      },
      params: { user_id_type: 'open_id' },
    });
    if (res.code !== 0) {
      throw new Error(`添加参会人失败 [${res.code}]: ${res.msg}`);
    }
  }

  async sendTextMessage(
    chatId: string,
    text: string,
    idempotencyKey?: string,
  ): Promise<string> {
    const client = this.getClient();
    const res = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
        ...(idempotencyKey ? { uuid: idempotencyKey } : {}),
      },
    });
    if (res.code !== 0) {
      throw new Error(`发送群消息失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.message_id ?? '';
  }

  async replyTextMessage(
    messageId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await this.getClient().im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text }),
        uuid: idempotencyKey,
      },
    });
    if (res.code !== 0) {
      throw new Error(`回复群消息失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.message_id ?? '';
  }

  async replyInteractiveCard(
    messageId: string,
    card: object,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await this.getClient().im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: idempotencyKey,
      },
    });
    if (res.code !== 0) {
      throw new Error(`回复交互卡片失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.message_id ?? '';
  }

  async sendInteractiveCard(
    chatId: string,
    card: object,
    idempotencyKey: string,
  ): Promise<string> {
    const res = await this.getClient().im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: idempotencyKey,
      },
    });
    if (res.code !== 0) {
      throw new Error(`发送日程卡片失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.message_id ?? '';
  }

  async updateInteractiveCard(messageId: string, card: object): Promise<void> {
    const res = await this.getClient().im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    });
    if (res.code !== 0) {
      throw new Error(`更新交互卡片失败 [${res.code}]: ${res.msg}`);
    }
  }

  async getCalendarEvent(eventId: string): Promise<CalendarEventRecord | null> {
    const res = await this.getClient().calendar.calendarEvent.get({
      path: { calendar_id: getCalendarId(), event_id: eventId },
      params: {
        need_attendee: true,
        max_attendee_num: 50,
        need_meeting_settings: true,
        user_id_type: 'open_id',
      },
    });
    if (res.code !== 0) {
      throw new Error(`读取日程失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.event ? this.toCalendarEventRecord(res.data.event) : null;
  }

  async sendMentionPost(
    chatId: string,
    openId: string,
    title: string,
    lines: string[],
    idempotencyKey: string,
  ): Promise<string> {
    const content = {
      zh_cn: {
        title,
        content: [
          [
            { tag: 'at', user_id: openId },
            { tag: 'text', text: ' 请查看以下安排：' },
          ],
          ...lines.map((text) => [{ tag: 'text', text }]),
        ],
      },
    };
    const res = await this.getClient().im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify(content),
        uuid: idempotencyKey,
      },
    });
    if (res.code !== 0) {
      throw new Error(`发送群消息失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.message_id ?? '';
  }

  async listCalendarEvents(
    start: Date,
    end?: Date,
  ): Promise<CalendarEventRecord[]> {
    const events: CalendarEventRecord[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.getClient().calendar.calendarEvent.list({
        path: { calendar_id: getCalendarId() },
        params: {
          start_time: String(Math.floor(start.getTime() / 1000)),
          ...(end
            ? { end_time: String(Math.floor(end.getTime() / 1000)) }
            : {}),
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
      if (res.code !== 0) {
        throw new Error(`查询日程失败 [${res.code}]: ${res.msg}`);
      }
      events.push(
        ...(res.data?.items ?? [])
          .map((item) => this.toCalendarEventRecord(item))
          .filter(
            (item): item is CalendarEventRecord =>
              item !== null && item.status !== 'cancelled',
          ),
      );
      pageToken = res.data?.has_more ? res.data.page_token : undefined;
      if (res.data?.has_more && !pageToken) {
        throw new Error('查询日程失败：分页令牌缺失');
      }
    } while (pageToken);
    return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  async getTodayEvents(
    reference: Date = new Date(),
  ): Promise<Array<{ summary: string; startTime: string; endTime: string }>> {
    const { startUnix, endUnix } = getShanghaiDayRange(reference);
    const events = await this.listCalendarEvents(
      new Date(startUnix * 1000),
      new Date(endUnix * 1000),
    );
    return events.map((event) => ({
      summary: event.summary,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
    }));
  }

  private formatApiError(error: unknown): string {
    if (typeof error !== 'object' || error === null) return String(error);
    const response = (
      error as {
        response?: {
          data?: { code?: number; msg?: string };
          headers?: Record<string, unknown>;
        };
        message?: string;
      }
    ).response;
    if (!response?.data) {
      return (error as { message?: string }).message || String(error);
    }
    const reset = response.headers?.['x-ogw-ratelimit-reset'];
    return `[${response.data.code ?? 'unknown'}] ${response.data.msg || '请求失败'}${reset ? `，${reset}秒后恢复` : ''}`;
  }

  private formatShanghaiDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  async getMessageLink(messageId: string): Promise<string> {
    const res = await this.getClient().im.message.get({
      path: { message_id: messageId },
      params: { user_id_type: 'open_id' },
    });
    if (res.code !== 0) {
      throw new Error(`读取原消息失败 [${res.code}]: ${res.msg}`);
    }
    return res.data?.items?.[0]?.message_app_link ?? '';
  }

  getRuntimeCallbackUrl(): string {
    return '';
  }

  async checkCalendarPermission(): Promise<{ ok: boolean; message: string }> {
    try {
      const client = this.getClient();
      const res = await client.calendar.calendarEvent.list({
        path: { calendar_id: getCalendarId() },
        params: { page_size: 1 },
      });
      if (res.code !== 0) {
        return {
          ok: false,
          message: `日历权限异常 [${res.code}]: ${res.msg}`,
        };
      }
      return { ok: true, message: '日历权限正常' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { ok: false, message: errMsg };
    }
  }

  private getHeader(
    headers:
      IncomingHttpHeaders | Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === name,
    )?.[1];
    return Array.isArray(value) ? value[0] : value;
  }

  private toCalendarEventRecord(item: {
    event_id: string;
    summary?: string;
    description?: string;
    start_time: { date?: string; timestamp?: string };
    end_time: { date?: string; timestamp?: string };
    location?: { name?: string };
    color?: number;
    reminders?: Array<{ minutes?: number }>;
    status?: string;
    app_link?: string;
    recurrence?: string;
    recurring_event_id?: string;
    is_exception?: boolean;
    attendees?: Array<{ type?: string }>;
    vchat?: { vc_type?: string };
  }): CalendarEventRecord | null {
    const allDay = !!item.start_time.date;
    const startTime = item.start_time.timestamp
      ? new Date(Number(item.start_time.timestamp) * 1000)
      : item.start_time.date
        ? new Date(`${item.start_time.date}T00:00:00+08:00`)
        : null;
    const endTime = item.end_time.timestamp
      ? new Date(Number(item.end_time.timestamp) * 1000)
      : item.end_time.date
        ? new Date(`${item.end_time.date}T00:00:00+08:00`)
        : null;
    if (!startTime || !endTime || !item.summary) return null;
    return {
      eventId: item.event_id,
      summary: item.summary,
      description: item.description,
      startTime,
      endTime,
      location: item.location?.name,
      color: item.color,
      reminders: item.reminders
        ?.map((reminder) => reminder.minutes)
        .filter((minutes): minutes is number => typeof minutes === 'number'),
      appLink: item.app_link,
      status: item.status,
      recurrence: item.recurrence,
      recurringEventId: item.recurring_event_id,
      isException: item.is_exception,
      attendeeCount: item.attendees?.length ?? 0,
      hasMeeting:
        !!item.vchat?.vc_type &&
        !['unknown', 'no_meeting'].includes(item.vchat.vc_type),
      allDay,
    };
  }
}
