import {
  buildPendingCalendarCard,
  buildSuccessCalendarCard,
  buildTerminalCalendarCard,
} from './interactive-card';

describe('interactive calendar cards', () => {
  it('红色冲突卡只携带操作标识并展示两个业务选项', () => {
    const card = buildPendingCalendarCard({
      actionId: 'act-1',
      operation: 'create',
      red: true,
      summary: '开会',
      timeText: '2026-07-18 14:00-15:00',
      colorName: '红色',
      conflicts: ['14:30-15:00｜客户电话'],
      expiresAt: '2026-07-16T08:00:00.000Z',
    });
    const json = JSON.stringify(card);
    expect(json).toContain('仍然创建');
    expect(json).toContain('暂不创建');
    expect(json).toContain('act-1');
    expect(json).toContain('"schema":"2.0"');
    expect(json).not.toContain('event_secret');
    expect(json).not.toContain('eventId');
  });

  it('红色无冲突卡显示确认创建且说明确认前不写入', () => {
    const card = buildPendingCalendarCard({
      actionId: 'act-red',
      operation: 'create',
      red: true,
      summary: '开庭',
      timeText: '2026-08-11 14:30-16:30',
      colorName: '红色',
      conflicts: [],
      expiresAt: '2026-07-16T08:00:00.000Z',
    });
    expect(JSON.stringify(card)).toContain('确认创建');
    expect(JSON.stringify(card)).toContain('确认前不会写入飞书日历');
  });

  it('重复日程卡片展示中文周期', () => {
    const pending = buildPendingCalendarCard({
      actionId: 'act-repeat',
      operation: 'create',
      red: false,
      summary: '交房租',
      timeText: '2026-07-28 10:00-11:00',
      colorName: '蓝色',
      recurrenceText: '每3个月',
      conflicts: [],
      expiresAt: '2026-07-28T02:00:00.000Z',
    });
    const success = buildSuccessCalendarCard({
      title: '日程创建成功',
      summary: '交房租',
      timeText: '2026-07-28 10:00-11:00',
      recurrenceText: '每3个月',
    });

    expect(JSON.stringify(pending)).toContain('每3个月');
    expect(JSON.stringify(success)).toContain('每3个月');
  });

  it('成功卡只在提供撤销状态时显示撤销按钮', () => {
    const withUndo = buildSuccessCalendarCard({
      title: '日程已创建',
      summary: '开会',
      timeText: '2026-07-18 14:00-15:00',
      undoActionId: 'undo-1',
      undoExpiresAt: '2026-07-15T08:10:00.000Z',
    });
    const withoutUndo = buildSuccessCalendarCard({
      title: '日程已取消',
      summary: '外部会议',
      timeText: '2026-07-18 14:00-15:00',
    });
    expect(JSON.stringify(withUndo)).toContain('撤销本次操作');
    expect(JSON.stringify(withoutUndo)).not.toContain('撤销本次操作');
  });

  it('终态卡不再包含回调按钮', () => {
    const card = buildTerminalCalendarCard({
      title: '已撤销',
      message: '本次创建已撤销。',
      status: 'success',
    });
    expect(JSON.stringify(card)).not.toContain('callback');
  });
});
