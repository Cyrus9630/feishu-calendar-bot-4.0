import {
  findExplicitScheduleDate,
  normalizeScheduleDateNotation,
} from './schedule-date-notation';

describe('shared date notation', () => {
  it.each([
    ['十月一日', '10月1日'],
    ['十月十七', '10月17日'],
    ['10月十七', '10月17日'],
    ['十 月 一 日', '10月1日'],
    ['10.1', '10月1日'],
    ['１０．０１', '10月1日'],
    ['10 / 1', '10月1日'],
    ['10-01号', '10月1号'],
    ['2026.10.1', '2026年10月1日'],
    ['27.10.1', '27年10月1日'],
    ['二〇二七年十月一日', '2027年10月1日'],
    ['十月1号', '10月1号'],
    ['10月01', '10月1日'],
  ])('canonicalizes %s', (source, expected) => {
    expect(normalizeScheduleDateNotation(source)).toBe(expected);
    expect(findExplicitScheduleDate(source)).toEqual({
      text: source,
      index: 0,
    });
  });
  it('preserves source offsets and spacing', () => {
    expect(normalizeScheduleDateNotation('10.8GG卡')).toBe('10月8日GG卡');
    expect(findExplicitScheduleDate('时间 十月十七 下午九点')).toEqual({
      text: '十月十七',
      index: 3,
    });
    expect(normalizeScheduleDateNotation('时间 十月十七 下午九点')).toBe(
      '时间 10月17日 下午九点',
    );
    expect(normalizeScheduleDateNotation('10.8开会；10.9复查')).toBe(
      '10月8日开会；10月9日复查',
    );
  });
  it.each([
    '费用10.1万元',
    '版本1.2',
    'v1.2',
    '材料.pdf',
    '1.5小时后',
    '编号 10.1',
    '利率3.5%',
    '110.1234',
    '2026.10.1.2',
  ])('does not treat %s as a date', (text) => {
    expect(findExplicitScheduleDate(text)).toBeNull();
    expect(normalizeScheduleDateNotation(text)).toBe(text);
  });
});
