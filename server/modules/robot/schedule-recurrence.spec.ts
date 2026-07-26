import {
  parseScheduleRecurrenceScope,
  parseScheduleRecurrence,
  recurringMasterEventId,
  stripScheduleRecurrence,
  truncateScheduleRecurrence,
} from './schedule-recurrence';

describe('schedule-recurrence', () => {
  const reference = new Date('2026-07-15T05:00:00.000Z');

  it('把已经过期的本年纪念日顺延为下一年的首次日程', () => {
    expect(
      parseScheduleRecurrence('每年5月7日结婚纪念日', reference),
    ).toEqual({
      rrule: 'FREQ=YEARLY;INTERVAL=1',
      label: '每年5月7日',
      dateText: '2027年5月7日',
    });
  });

  it('本年尚未到达的生日从本年开始', () => {
    expect(
      parseScheduleRecurrence('每年8月16日生日', reference),
    ).toMatchObject({
      rrule: 'FREQ=YEARLY;INTERVAL=1',
      dateText: '2026年8月16日',
    });
  });

  it('年度日程同一天的开始时间已过时从下一年开始', () => {
    expect(
      parseScheduleRecurrence(
        '每年7月15日下午两点纪念日',
        new Date('2026-07-15T07:00:00.000Z'),
        '下午2点',
      ),
    ).toMatchObject({ dateText: '2027年7月15日' });
  });

  it('保留明确的两位首次年份', () => {
    expect(
      parseScheduleRecurrence('27年5月7日每年结婚纪念日', reference),
    ).toMatchObject({
      dateText: '2027年5月7日',
      rrule: 'FREQ=YEARLY;INTERVAL=1',
    });
  });

  it.each([
    ['7月28日每三个月交房租', 3],
    ['7月28日每6个月GG卡', 6],
    ['27年7月28日每十二个月续费', 12],
    ['7月28日每月盘点', 1],
  ])('解析明确首次日期的按月重复：%s', (text, interval) => {
    expect(parseScheduleRecurrence(text, reference)).toEqual({
      rrule: `FREQ=MONTHLY;INTERVAL=${interval}`,
      label: `每${interval}个月`,
      dateText: expect.any(String),
    });
  });

  it('按月重复缺少首次日期时拒绝推测', () => {
    expect(() => parseScheduleRecurrence('每三个月交房租', reference)).toThrow(
      '按月重复日程需要明确首次日期',
    );
  });

  it('普通日程不生成重复规则', () => {
    expect(parseScheduleRecurrence('7月28日交房租', reference)).toBeNull();
  });

  it('拒绝无法成立的年度日期', () => {
    expect(() => parseScheduleRecurrence('每年2月30日纪念日', reference)).toThrow(
      '日期无效',
    );
  });

  it.each([
    ['每年5月7日结婚纪念日', '结婚纪念日'],
    ['7月28日每三个月交房租', '交房租'],
    ['每6个月GG卡', 'GG卡'],
  ])('从误带周期和日期的标题中保留事项：%s', (text, expected) => {
    expect(stripScheduleRecurrence(text)).toBe(expected);
  });

  it.each([
    ['仅此次', 'single'],
    ['只改本次', 'single'],
    ['本次及后续', 'future'],
    ['从这次开始', 'future'],
    ['全部日程', 'all'],
    ['每次都修改', 'all'],
  ] as const)('识别重复日程作用范围：%s', (text, expected) => {
    expect(parseScheduleRecurrenceScope(text)).toBe(expected);
  });

  it('从实例编号取得重复系列主日程编号', () => {
    expect(recurringMasterEventId('uid_1785213600')).toBe('uid_0');
    expect(recurringMasterEventId('instance', 'master_0')).toBe('master_0');
  });

  it('从选中实例之前一秒截断原重复规则', () => {
    expect(
      truncateScheduleRecurrence(
        'FREQ=MONTHLY;INTERVAL=3;UNTIL=20280101T000000Z',
        new Date('2026-10-28T02:00:00.000Z'),
      ),
    ).toBe('FREQ=MONTHLY;INTERVAL=3;UNTIL=20261028T015959Z');
  });
});
