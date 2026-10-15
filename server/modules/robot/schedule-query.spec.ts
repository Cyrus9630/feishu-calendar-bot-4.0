import { parseScheduleQuery } from './schedule-query';

describe('parseScheduleQuery', () => {
  const now = new Date('2026-07-16T05:00:00.000Z'); // 周四 13:00
  it.each([
    ['11月11日前16天的安排', '2026-10-26'],
    ['11月11日之后16天有什么安排', '2026-11-27'],
    ['11月11日前一周的安排', '2026-11-04'],
    ['11月11日前两月的安排', '2026-09-11'],
    ['11月11日之后一个月有什么安排', '2026-12-11'],
    ['一周后的安排', '2026-10-22'],
    ['两月后的安排', '2026-12-15'],
  ])('查询与添加共用锚点偏移日期：%s', (text, date) => {
    const query = parseScheduleQuery(text, new Date('2026-10-15T04:00:00Z'))!;
    expect(query.start).toEqual(new Date(`${date}T00:00:00+08:00`));
    expect(query.end.getTime() - query.start.getTime()).toBe(86400000);
  });
  it.each(['十月一日的安排', '10.1的安排', '１０．１日程', '十月一有什么安排'])(
    '明确过去日期可以查询：%s',
    (text) => {
      const query = parseScheduleQuery(text, new Date('2026-10-03T00:00:00Z'))!;
      expect(query.start.toISOString()).toBe('2026-09-30T16:00:00.000Z');
      expect(query.end.toISOString()).toBe('2026-10-01T16:00:00.000Z');
    },
  );
  it('既有整周查询不被日期探测拦截', () => {
    expect(parseScheduleQuery('下周的安排', now)?.label).toBe('下周日程');
    expect(
      parseScheduleQuery('下周三有什么安排', now)?.start.toISOString(),
    ).toBe('2026-07-21T16:00:00.000Z');
  });
  it.each(['删除10.8的日程', '修改10.8的日程', '10.8复查', '十月十七体检'])(
    '不把变更输入误判为查询：%s',
    (text) => {
      expect(parseScheduleQuery(text, now)).toBeNull();
    },
  );

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
