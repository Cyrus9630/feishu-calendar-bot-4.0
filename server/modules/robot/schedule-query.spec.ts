import { parseScheduleQuery } from './schedule-query';

describe('parseScheduleQuery', () => {
  const now = new Date('2026-07-16T05:00:00.000Z'); // 周四 13:00

  it('识别明日日程查询', () => {
    const query = parseScheduleQuery('我明天什么安排', now);
    expect(query?.label).toBe('明日日程');
    expect(query?.start.toISOString()).toBe('2026-07-16T16:00:00.000Z');
    expect(query?.end.toISOString()).toBe('2026-07-17T16:00:00.000Z');
  });

  it('下周按周一到周日计算', () => {
    const query = parseScheduleQuery('下周什么安排', now);
    expect(query?.start.toISOString()).toBe('2026-07-19T16:00:00.000Z');
    expect(query?.end.toISOString()).toBe('2026-07-26T16:00:00.000Z');
  });

  it('只说颜色时默认查询未来一年', () => {
    const query = parseScheduleQuery('我有哪几个红色安排', now);
    expect(query?.colorName).toBe('红色');
    expect(query?.start).toEqual(now);
    expect(query?.end.toISOString()).toBe('2027-07-16T05:00:00.000Z');
    expect(query?.label).toContain('未来一年');
  });

  it('创建指令不会误判为查询', () => {
    expect(parseScheduleQuery('明天安排下午三点开会', now)).toBeNull();
  });
});
