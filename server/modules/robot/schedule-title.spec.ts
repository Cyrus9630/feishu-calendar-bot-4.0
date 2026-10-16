import {
  extractScheduleMatterText,
  preserveScheduleTitle,
  sourceScheduleColor,
} from './schedule-title';

describe('schedule-title', () => {
  it.each([
    ['下周六中午吃饭 张先生', '吃饭', '', '吃饭 张先生'],
    ['下周六中午吃饭 王先生 黄色', '吃饭', '', '吃饭 王先生'],
    ['下周六中午王先生 吃饭 黄色', '吃饭', '', '王先生 吃饭'],
    [
      '明天下午3点 见客户 项目A 讨论付款条款 蓝色',
      '见客户',
      '',
      '见客户 项目A 讨论付款条款',
    ],
    ['明天 吃饭 王先生', '吃饭', '王先生', '吃饭 王先生'],
    [
      '明天在海底捞吃饭 王先生 黄色 提前30分钟提醒',
      '吃饭',
      '海底捞',
      '吃饭 王先生',
    ],
    ['11月11日前一周 联系 王律师 续封 红色', '联系', '', '联系 王律师 续封'],
    [
      '7月28日每三个月交房租 房东张先生 黄色',
      '交房租',
      '',
      '交房租 房东张先生',
    ],
    ['明天见黄力 蓝色计划 蓝色', '见黄力', '', '见黄力 蓝色计划'],
  ])('不会在空格处截断事项：%s', (source, title, location, expected) => {
    expect(preserveScheduleTitle(source, title, location)).toBe(expected);
  });
  it('只包含设置时不捏造事项', () => {
    expect(extractScheduleMatterText('明天下午3点 黄色')).toBe('');
  });
  it('颜色不吃掉姓氏或事项词', () => {
    expect(sourceScheduleColor('吃饭 黄力 蓝色计划')).toBeUndefined();
    expect(sourceScheduleColor('王先生吃饭黄色')?.name).toBe('黄色');
  });
});
