import { normalizeSpokenSchedule } from './schedule-language';

describe('normalizeSpokenSchedule', () => {
  it.each([
    ['七月二十三号上午九点开庭', '7月23号上午9点开庭'],
    ['二十七年五月七日结婚纪念日', '27年5月7日结婚纪念日'],
    ['二〇二七年五月七日结婚纪念日', '2027年5月7日结婚纪念日'],
    ['礼拜3下午两点开会', '礼拜三下午2点开会'],
    ['星期5上午体检', '星期五上午体检'],
    ['周7晚上吃饭', '周日晚上吃饭'],
  ])('规范中文日期和混合星期：%s', (source, expected) => {
    expect(normalizeSpokenSchedule(source).text).toBe(expected);
  });

  it.each([
    ['明早体检', '明天上午体检'],
    ['今晚开会', '今天晚上开会'],
    ['明晚吃饭', '明天晚上吃饭'],
    ['明天晚上吃饭', '明天晚上吃饭'],
    ['再过十天确认是否上诉', '10天后确认是否上诉'],
    ['过两个月交房租', '2个月后交房租'],
    ['一周后复查', '7天后复查'],
  ])('规范日期时段缩写和相对口语：%s', (source, expected) => {
    expect(normalizeSpokenSchedule(source).text).toBe(expected);
  });

  it.each([
    ['三点四零开会', '3点40分开会'],
    ['九点一刻开庭', '9点15分开庭'],
    ['下午三点四十分见客户', '下午3点40分见客户'],
  ])('规范语音时间：%s', (source, expected) => {
    expect(normalizeSpokenSchedule(source).text).toBe(expected);
  });

  it.each([
    ['明天下午3点开会一个半小时', '明天下午3点开会', 90],
    ['17号体检半小时', '17号体检', 30],
    ['明天开会俩小时', '明天开会', 120],
    ['明天培训90分钟', '明天培训', 90],
  ])('提取自然时长：%s', (source, text, durationMinutes) => {
    expect(normalizeSpokenSchedule(source)).toEqual({ text, durationMinutes });
  });

  it.each([
    ['麻烦帮我记一下，17号上午体检', '17号上午体检'],
    ['提醒我明天下午开会', '明天下午开会'],
    ['我想在后天晚上吃饭', '后天晚上吃饭'],
    ['明天不要忘了开会', '明天开会'],
  ])('去除不属于事项的口头铺垫：%s', (source, expected) => {
    expect(normalizeSpokenSchedule(source).text).toBe(expected);
  });

  it.each([
    ['明天不开会了', '取消明天开会'],
    ['明天不用开会了', '取消明天开会'],
    ['17号体检取消', '取消17号体检'],
    ['刚才那个不要了', '取消刚才'],
  ])('把确定的否定表达规范为取消：%s', (source, expected) => {
    expect(normalizeSpokenSchedule(source).text).toBe(expected);
  });

  it.each([
    ['周末开会', '周末'],
    ['月底处理', '月底'],
    ['下午三四点开会', '具体钟点'],
    ['晚点联系客户', '具体时间'],
    ['过几天确认', '具体数字'],
    ['下午3点左右开会', '近似时间'],
    ['这个不要了', '目标日程'],
  ])('拒绝歧义表达：%s', (source, message) => {
    expect(() => normalizeSpokenSchedule(source)).toThrow(message);
  });
});
