import { parseCrossDayScheduleRange } from './schedule-range';

describe('parseCrossDayScheduleRange', () => {
  const now = new Date('2026-07-16T05:00:00.000Z');

  it('把只有日期的区间解释为包含结束日的全天跨日事项', () => {
    const range = parseCrossDayScheduleRange('7月20日至22日出差', now);
    expect(range).toEqual({
      startTime: new Date('2026-07-19T16:00:00.000Z'),
      endTime: new Date('2026-07-22T16:00:00.000Z'),
      allDay: true,
    });
  });

  it('识别带起止时刻的跨日事项', () => {
    const range = parseCrossDayScheduleRange(
      '7月20日下午3点到22日上午10点出差',
      now,
    );
    expect(range?.startTime.toISOString()).toBe('2026-07-20T07:00:00.000Z');
    expect(range?.endTime.toISOString()).toBe('2026-07-22T02:00:00.000Z');
    expect(range?.allDay).toBe(false);
  });

  it('只有一个端点写时间时拒绝猜测', () => {
    expect(() =>
      parseCrossDayScheduleRange('7月20日下午3点到22日出差', now),
    ).toThrow('跨日日程请同时写明开始和结束时间');
  });

  it('普通单日日程不匹配', () => {
    expect(parseCrossDayScheduleRange('7月20日下午3点开会', now)).toBeNull();
  });
});
