import { HealthAlertService } from './health-alert.service';

describe('HealthAlertService', () => {
  beforeEach(() => {
    process.env.CHAT_ID = 'oc_target';
    process.env.TARGET_OPEN_ID = 'ou_owner';
  });

  it('持续失败只报警一次，恢复后只通知一次', async () => {
    let state: any = null;
    const feishu = { sendMentionPost: jest.fn().mockResolvedValue('om_alert') };
    const store = {
      getHealthIncident: jest.fn().mockImplementation(async () => state),
      saveHealthIncident: jest.fn().mockImplementation(async (_key, next) => {
        state = next;
      }),
      getScheduledRunStatus: jest.fn(),
    };
    const service = new HealthAlertService(feishu as never, store as never);

    await service.failed('daily_0900', '任务失败');
    await service.failed('daily_0900', '任务仍失败');
    await service.recovered('daily_0900');
    await service.recovered('daily_0900');

    expect(feishu.sendMentionPost).toHaveBeenCalledTimes(2);
    expect(feishu.sendMentionPost.mock.calls[0][2]).toBe(
      '飞书日程助手运行异常',
    );
    expect(feishu.sendMentionPost.mock.calls[1][2]).toBe('飞书日程助手已恢复');
  });

  it('发现预期任务漏跑时报警', async () => {
    const feishu = { sendMentionPost: jest.fn().mockResolvedValue('om_alert') };
    const store = {
      getScheduledRunStatus: jest.fn().mockResolvedValue(null),
      getHealthIncident: jest.fn().mockResolvedValue(null),
      saveHealthIncident: jest.fn().mockResolvedValue(undefined),
    };
    const service = new HealthAlertService(feishu as never, store as never);
    await service.checkExpected('early_1700', '2026-07-15');
    expect(feishu.sendMentionPost).toHaveBeenCalledWith(
      'oc_target',
      'ou_owner',
      '飞书日程助手运行异常',
      expect.arrayContaining([expect.stringContaining('没有按时执行')]),
      expect.any(String),
    );
  });
});
