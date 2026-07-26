import { ReminderService } from './reminder.service';

describe('ReminderService', () => {
  const reference = new Date('2026-07-14T01:00:00.000Z');
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CHAT_ID: 'oc_target',
      TARGET_OPEN_ID: 'ou_owner',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setup(events: unknown[]) {
    const feishu = {
      listCalendarEvents: jest.fn().mockResolvedValue(events),
      sendTextMessage: jest.fn().mockResolvedValue('om_empty'),
      sendMentionPost: jest.fn().mockResolvedValue('om_push'),
    };
    const store = {
      claimScheduledRun: jest.fn().mockResolvedValue(true),
      finishScheduledRun: jest
        .fn()
        .mockImplementation((_kind, _date, result) => ({
          sent: result === 'sent',
          reason: result,
        })),
    };
    return {
      service: new ReminderService(feishu as never, store as never),
      feishu,
      store,
    };
  }

  it('09:00 当天无日程时发送休息提示', async () => {
    const { service, feishu } = setup([]);
    await expect(service.pushToday(reference)).resolves.toEqual({
      sent: true,
      reason: 'sent',
    });
    expect(feishu.sendTextMessage).toHaveBeenCalledWith(
      'oc_target',
      '今天暂无安排，要不休息下吧～',
      expect.any(String),
    );
    expect(feishu.sendMentionPost).not.toHaveBeenCalled();
  });

  it('09:00 有日程时真正 @目标用户并按全天优先', async () => {
    const timed = {
      eventId: 'evt_1', summary: '体检',
      startTime: new Date('2026-07-14T10:00:00+08:00'),
      endTime: new Date('2026-07-14T11:00:00+08:00'),
      location: '医院', allDay: false,
    };
    const allDay = {
      eventId: 'evt_2', summary: '全天事项',
      startTime: new Date('2026-07-14T00:00:00+08:00'),
      endTime: new Date('2026-07-15T00:00:00+08:00'), allDay: true,
    };
    const { service, feishu } = setup([timed, allDay]);
    await service.pushToday(reference);
    expect(feishu.sendMentionPost).toHaveBeenCalledWith(
      'oc_target', 'ou_owner', '今日日程',
      ['1. 全天｜全天事项', '2. 10:00-11:00｜体检｜医院'],
      expect.any(String),
    );
  });

  it('17:00 包含次日 09:30，排除 09:31', async () => {
    const event = (id: string, time: string) => ({
      eventId: id, summary: id,
      startTime: new Date(`2026-07-15T${time}:00+08:00`),
      endTime: new Date(`2026-07-15T10:30:00+08:00`), allDay: false,
    });
    const { service, feishu } = setup([
      event('九点半', '09:30'), event('九点三十一', '09:31'),
    ]);
    await service.pushTomorrowEarly(reference);
    expect(feishu.sendMentionPost).toHaveBeenCalledWith(
      'oc_target', 'ou_owner', '次日早间日程提醒',
      ['1. 09:30-10:30｜九点半'], expect.any(String),
    );
  });
});
