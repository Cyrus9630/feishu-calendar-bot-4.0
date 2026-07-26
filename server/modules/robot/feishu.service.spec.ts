import * as crypto from 'crypto';
import { FeishuService } from './feishu.service';

describe('FeishuService', () => {
  const originalEnv = process.env;
  let service: FeishuService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FEISHU_ENCRYPT_KEY = 'test-encrypt-key';
    process.env.FEISHU_VERIFICATION_TOKEN = 'test-token';
    service = new FeishuService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('接受签名正确的事件', () => {
    const rawBody = Buffer.from('{"event":"value"}', 'utf8');
    const timestamp = '1784000000';
    const nonce = 'nonce-value';
    const signature = crypto
      .createHash('sha256')
      .update(timestamp + nonce + 'test-encrypt-key')
      .update(rawBody)
      .digest('hex');

    expect(
      service.isEventAuthorized(
        {
          'x-lark-request-timestamp': timestamp,
          'x-lark-request-nonce': nonce,
          'x-lark-signature': signature,
        },
        rawBody,
        { header: { token: 'wrong-token' } },
      ),
    ).toBe(true);
  });

  it('网关改变原始请求体时允许有效 Verification Token 通过', () => {
    expect(
      service.isEventAuthorized(
        {
          'x-lark-request-timestamp': '1784000000',
          'x-lark-request-nonce': 'nonce-value',
          'x-lark-signature': 'wrong-signature',
        },
        Buffer.from('{"rewritten":true}', 'utf8'),
        { header: { token: 'test-token' } },
      ),
    ).toBe(true);
  });

  it('签名和 Verification Token 均无效时拒绝', () => {
    expect(
      service.isEventAuthorized({}, Buffer.from('{}', 'utf8'), {
        header: { token: 'wrong-token' },
      }),
    ).toBe(false);
  });

  it('服务端未配置 Verification Token 时不自动放行', () => {
    delete process.env.FEISHU_VERIFICATION_TOKEN;
    delete process.env.VERIFICATION_TOKEN;

    expect(
      service.checkVerificationToken({ header: { token: 'anything' } }),
    ).toBe(false);
  });

  it('日历接口返回非零错误码时权限检查失败', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const calendarEvent = {
      list: jest.fn().mockResolvedValue({
        code: 99991672,
        msg: 'app scope not applied',
      }),
    };
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: typeof calendarEvent } };
    };
    mocked.client = { calendar: { calendarEvent } };

    await expect(service.checkCalendarPermission()).resolves.toEqual({
      ok: false,
      message: '日历权限异常 [99991672]: app scope not applied',
    });
    expect(calendarEvent.list).toHaveBeenCalledWith({
      path: { calendar_id: 'user-primary-calendar' },
      params: { page_size: 1 },
    });
  });

  it('创建日程时把消息 UUID 作为飞书幂等键', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const create = jest.fn().mockResolvedValue({
      code: 0,
      data: { event: { event_id: 'evt_calendar_1' } },
    });
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { create: typeof create } } };
    };
    mocked.client = { calendar: { calendarEvent: { create } } };

    const startTime = new Date('2026-07-15T15:00:00+08:00');
    const endTime = new Date('2026-07-15T16:00:00+08:00');
    await expect(
      service.createCalendarEvent(
        {
          summary: '机器人修复验收',
          startTime,
          endTime,
          color: 0xffc60a,
          location: '体检中心',
          description: '年度体检',
          reminders: [30],
          recurrence: 'FREQ=YEARLY;INTERVAL=1',
        },
        '25fdf41b-8c80-2ce1-e94c-de8b5e7aa7e6',
      ),
    ).resolves.toBe('evt_calendar_1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { calendar_id: 'user-primary-calendar' },
        params: {
          idempotency_key: '25fdf41b-8c80-2ce1-e94c-de8b5e7aa7e6',
        },
        data: expect.objectContaining({
          color: 0xffc60a,
          location: { name: '体检中心' },
          description: '年度体检',
          reminders: [{ minutes: 30 }],
          recurrence: 'FREQ=YEARLY;INTERVAL=1',
        }),
      }),
    );
  });

  it('修改日程时透传重复规则', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const patch = jest.fn().mockResolvedValue({ code: 0 });
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { patch: typeof patch } } };
    };
    mocked.client = { calendar: { calendarEvent: { patch } } };

    await service.patchCalendarEvent('evt_1', {
      recurrence: 'FREQ=MONTHLY;INTERVAL=3',
    });

    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrence: 'FREQ=MONTHLY;INTERVAL=3',
        }),
      }),
    );
  });

  it('创建全天跨日日程时使用日期型起止时间', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const create = jest.fn().mockResolvedValue({
      code: 0,
      data: { event: { event_id: 'evt_trip' } },
    });
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { create: typeof create } } };
    };
    mocked.client = { calendar: { calendarEvent: { create } } };

    await service.createCalendarEvent(
      {
        summary: '出差',
        startTime: new Date('2026-07-20T00:00:00+08:00'),
        endTime: new Date('2026-07-23T00:00:00+08:00'),
        allDay: true,
      },
      'all-day-key',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          start_time: { date: '2026-07-20' },
          end_time: { date: '2026-07-23' },
        }),
      }),
    );
  });

  it('修改日程接口返回 HTTP 错误时保留飞书错误码和原因', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const patch = jest.fn().mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        response: {
          data: {
            code: 99991672,
            msg: 'missing calendar update scope',
          },
        },
      }),
    );
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { patch: typeof patch } } };
    };
    mocked.client = { calendar: { calendarEvent: { patch } } };

    await expect(
      service.patchCalendarEvent('evt_1', { color: 0xffc60a }),
    ).rejects.toThrow('修改日程失败：[99991672] missing calendar update scope');
  });

  it('范围查询过滤已取消日程并保留地点', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const list = jest.fn().mockResolvedValue({
      code: 0,
      data: {
        items: [
          {
            event_id: 'evt_1',
            summary: '体检',
            start_time: { timestamp: '1784252400' },
            end_time: { timestamp: '1784256000' },
            location: { name: '体检中心' },
            status: 'confirmed',
          },
          {
            event_id: 'evt_2',
            summary: '已取消',
            start_time: { timestamp: '1784252400' },
            end_time: { timestamp: '1784256000' },
            status: 'cancelled',
          },
        ],
      },
    });
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { list: typeof list } } };
    };
    mocked.client = { calendar: { calendarEvent: { list } } };
    const events = await service.listCalendarEvents(
      new Date('2026-07-17T00:00:00+08:00'),
      new Date('2026-07-17T23:59:59+08:00'),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        summary: '体检',
        location: '体检中心',
        attendeeCount: 0,
        hasMeeting: false,
      }),
    );
  });

  it('分页读取指定开始时间后的全部有效日程', async () => {
    process.env.TARGET_CALENDAR_ID = 'user-primary-calendar';
    const eventItem = (eventId: string, timestamp: string) => ({
      event_id: eventId,
      summary: eventId,
      start_time: { timestamp },
      end_time: { timestamp: String(Number(timestamp) + 3600) },
      status: 'confirmed',
    });
    const list = jest
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          has_more: true,
          page_token: 'page-2',
          items: [eventItem('evt_1', '1784163600')],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          has_more: false,
          items: [
            {
              ...eventItem('evt_2', '1784250000'),
              app_link:
                'https://applink.feishu.cn/client/calendar/event/detail?eventId=evt_2',
            },
          ],
        },
      });
    const mocked = service as unknown as {
      client: { calendar: { calendarEvent: { list: typeof list } } };
    };
    mocked.client = { calendar: { calendarEvent: { list } } };

    const events = await service.listCalendarEvents(
      new Date('2026-07-16T00:00:00+08:00'),
    );

    expect(events.map((event) => event.eventId)).toEqual(['evt_1', 'evt_2']);
    expect(events[1].appLink).toContain('evt_2');
    expect(list).toHaveBeenNthCalledWith(2, {
      path: { calendar_id: 'user-primary-calendar' },
      params: {
        start_time: '1784131200',
        page_size: 500,
        page_token: 'page-2',
      },
    });
  });

  it('回复并更新 Card 2.0 交互卡片', async () => {
    const reply = jest.fn().mockResolvedValue({
      code: 0,
      data: { message_id: 'om_card' },
    });
    const patch = jest.fn().mockResolvedValue({ code: 0 });
    const mocked = service as unknown as {
      client: { im: { message: { reply: typeof reply; patch: typeof patch } } };
    };
    mocked.client = { im: { message: { reply, patch } } };
    const card = { schema: '2.0', config: { update_multi: true } };

    await expect(
      service.replyInteractiveCard('om_source', card, 'uuid-1'),
    ).resolves.toBe('om_card');
    await expect(
      service.updateInteractiveCard('om_card', card),
    ).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith({
      path: { message_id: 'om_source' },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: 'uuid-1',
      },
    });
    expect(patch).toHaveBeenCalledWith({
      path: { message_id: 'om_card' },
      data: { content: JSON.stringify(card) },
    });
  });
});
