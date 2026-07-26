import {
  EVENT_COLORS,
  getMissingCommandFields,
  hasExplicitSourceTime,
  isHelpText,
  parseHelpTopic,
  normalizeColor,
  normalizeScheduleCommand,
} from './schedule-command';

describe('schedule-command', () => {
  it('未指定颜色时使用蓝色', () => {
    expect(normalizeColor('')).toEqual({ name: '蓝色', rgb: 0x3370ff });
  });

  it('黄色和标黄映射到同一颜色', () => {
    expect(normalizeColor('黄色')).toEqual(normalizeColor('标黄'));
    expect(normalizeColor('黄标').rgb).toBe(EVENT_COLORS.黄色);
  });

  it('拒绝多个颜色或不支持的颜色', () => {
    expect(() => normalizeColor('黄色 蓝色')).toThrow('多个颜色');
    expect(() => normalizeColor('粉色')).toThrow('暂支持');
  });

  it('普通创建默认 60 分钟、蓝色和提前 30 分钟提醒', () => {
    expect(
      normalizeScheduleCommand({
        action: '创建',
        title: '体检',
        date: '17号',
        start_time: '上午7点',
      }),
    ).toEqual({
      action: 'create',
      title: '体检',
      dateText: '17号',
      startText: '上午7点',
      endText: '',
      durationMinutes: 60,
      color: { name: '蓝色', rgb: EVENT_COLORS.蓝色 },
      colorExplicit: false,
      location: '',
      reminderMinutes: [30],
    });
  });

  it('记录颜色是否由用户明确提供', () => {
    expect(normalizeScheduleCommand({ color: '' }).colorExplicit).toBe(false);
    expect(normalizeScheduleCommand({ color: '黄色' }).colorExplicit).toBe(true);
  });

  it('有事项和日期但没有时间时允许进入创建流程且不在标准化阶段补时间', () => {
    const command = normalizeScheduleCommand({
      action: 'create',
      title: '体检',
      date: '17号',
    });
    expect(command.startText).toBe('');
    expect(getMissingCommandFields(command)).toEqual([]);
  });

  it('只把原样出现在用户文本中的时间视为明确时间', () => {
    expect(hasExplicitSourceTime('把17号体检改到上午8点', '上午8点')).toBe(true);
    expect(hasExplicitSourceTime('把17号体检改为黄色', '上午10点')).toBe(false);
    expect(hasExplicitSourceTime('取消17号体检', '')).toBe(false);
  });

  it('忽略时间中的空格、全半角分隔符和可选分字', () => {
    expect(hasExplicitSourceTime('17号上午 7 点体检', '上午7点')).toBe(true);
    expect(hasExplicitSourceTime('17号下午 3：40 开会', '下午3:40')).toBe(true);
    expect(hasExplicitSourceTime('17号下午3、40分开会', '下午3点40')).toBe(true);
  });

  it('只要求事项，日期可以默认当天', () => {
    const command = normalizeScheduleCommand({});
    expect(getMissingCommandFields(command)).toEqual(['事项']);
  });

  it('识别帮助主题', () => {
    expect(isHelpText('帮助')).toBe(true);
    expect(parseHelpTopic('帮助 修改')).toBe('update');
    expect(parseHelpTopic('帮助 不存在')).toBeNull();
  });
});
