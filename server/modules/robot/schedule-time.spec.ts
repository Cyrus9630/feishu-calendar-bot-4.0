import {
  computeScheduleRange,
  findScheduleDateExpression,
  getShanghaiDayRange,
  getTomorrowEarlyRange,
  isRecognizedScheduleTime,
  resolveScheduleDate,
} from './schedule-time';

describe('schedule-time', () => {
  const reference = new Date('2026-07-14T05:00:00.000Z');

  it('解析明天下午三点并默认持续 60 分钟', () => {
    const range = computeScheduleRange('明天', '下午3点', 0, reference);

    expect(range.startTime.toISOString()).toBe('2026-07-15T07:00:00.000Z');
    expect(range.endTime.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('解析中文数字上午十点', () => {
    const range = computeScheduleRange('后天', '上午十点', 30, reference);

    expect(range.startTime.toISOString()).toBe('2026-07-16T02:00:00.000Z');
    expect(range.endTime.toISOString()).toBe('2026-07-16T02:30:00.000Z');
  });

  it('解析下周一上午九点半', () => {
    const range = computeScheduleRange('下周一', '上午9点半', 60, reference);

    expect(range.startTime.toISOString()).toBe('2026-07-20T01:30:00.000Z');
  });

  it('得到上海自然日边界', () => {
    expect(getShanghaiDayRange(reference)).toEqual({
      startUnix: 1783958400,
      endUnix: 1784044799,
    });
  });

  it('拒绝已经完全过去的日程', () => {
    expect(() =>
      computeScheduleRange('今天', '上午9点', 60, reference),
    ).toThrow('开始时间已经过去');
  });

  it('拒绝无法识别的时间', () => {
    expect(() =>
      computeScheduleRange('明天', '晚些时候', 60, reference),
    ).toThrow('无法识别时间');
  });

  it('只把时间解析器能够识别的文本视为有效时间', () => {
    expect(isRecognizedScheduleTime('上午')).toBe(true);
    expect(isRecognizedScheduleTime('下午3点')).toBe(true);
    expect(isRecognizedScheduleTime('默认时间')).toBe(false);
    expect(isRecognizedScheduleTime('')).toBe(false);
  });

  it.each([
    ['上午', '2026-07-17T02:00:00.000Z'],
    ['下午', '2026-07-17T06:00:00.000Z'],
    ['晚上', '2026-07-17T11:00:00.000Z'],
    ['上午7点', '2026-07-16T23:00:00.000Z'],
  ])('把当月 17 号%s解释为确定时间', (time, expected) => {
    const range = computeScheduleRange('17号', time, '', 0, reference);
    expect(range.startTime.toISOString()).toBe(expected);
  });

  it.each([
    ['今天', '2026-07-13T16:00:00.000Z'],
    ['明天', '2026-07-14T16:00:00.000Z'],
    ['后天', '2026-07-15T16:00:00.000Z'],
    ['17号', '2026-07-16T16:00:00.000Z'],
    ['7月20日', '2026-07-19T16:00:00.000Z'],
    ['本周五', '2026-07-16T16:00:00.000Z'],
    ['下周一', '2026-07-19T16:00:00.000Z'],
  ])('只解析日期表达 %s，不附加推测钟点', (dateText, expected) => {
    expect(resolveScheduleDate(dateText, reference).toISOString()).toBe(expected);
  });

  it('当天下午查询日期时不因 10:00 已经过期而失败', () => {
    const afternoon = new Date('2026-07-14T07:00:00.000Z');
    expect(resolveScheduleDate('今天', afternoon).toISOString()).toBe(
      '2026-07-13T16:00:00.000Z',
    );
  });

  it('不把已经过去的当月日期自动滚到下个月', () => {
    expect(() =>
      computeScheduleRange('10号', '上午10点', '', 0, reference),
    ).toThrow('日期已经过去，请补充月份');
  });

  it('明确结束时间优先于默认时长', () => {
    const range = computeScheduleRange(
      '17号',
      '上午9点',
      '上午10点半',
      0,
      reference,
    );
    expect(range.endTime.toISOString()).toBe('2026-07-17T02:30:00.000Z');
  });

  it.each([
    ['下午3点40', '2026-07-17T07:40:00.000Z'],
    ['下午3点40分', '2026-07-17T07:40:00.000Z'],
    ['下午3:40', '2026-07-17T07:40:00.000Z'],
    ['下午3：40', '2026-07-17T07:40:00.000Z'],
    ['下午3、40', '2026-07-17T07:40:00.000Z'],
    ['晚上7:30', '2026-07-17T11:30:00.000Z'],
  ])('把多种时间格式“%s”解析为同一时钟', (time, expected) => {
    expect(
      computeScheduleRange('17号', time, '', 60, reference).startTime.toISOString(),
    ).toBe(expected);
  });

  it('结束时间未重复时段词时继承开始时间的下午语义', () => {
    const range = computeScheduleRange(
      '17号',
      '下午3点',
      '4点',
      0,
      reference,
    );
    expect(range.startTime.toISOString()).toBe('2026-07-17T07:00:00.000Z');
    expect(range.endTime.toISOString()).toBe('2026-07-17T08:00:00.000Z');
  });

  it('拒绝上午14点一类矛盾表达', () => {
    expect(() =>
      computeScheduleRange('17号', '上午14点', '', 0, reference),
    ).toThrow('时间表达矛盾');
  });

  it('次日早间范围包含 09:30 边界', () => {
    const range = getTomorrowEarlyRange(reference);
    expect(range.start.toISOString()).toBe('2026-07-14T16:00:00.000Z');
    expect(range.endInclusive.toISOString()).toBe('2026-07-15T01:30:00.000Z');
  });

  describe('相对时间规则', () => {
    it.each([
      ['十天后', '2026-07-24T02:00:00.000Z'],
      ['10 天后', '2026-07-24T02:00:00.000Z'],
      ['两个月后', '2026-09-14T02:00:00.000Z'],
      ['2 个 月 后', '2026-09-14T02:00:00.000Z'],
    ])('%s 未写钟点时使用目标日 10:00', (dateText, expected) => {
      expect(
        computeScheduleRange(dateText, '上午', '', 60, reference).startTime.toISOString(),
      ).toBe(expected);
      expect(findScheduleDateExpression(`创建${dateText}事项`)?.text).toBe(dateText);
    });

    it('相对天数可以继续指定具体钟点', () => {
      expect(
        computeScheduleRange('十天后', '下午3点', '', 60, reference).startTime.toISOString(),
      ).toBe('2026-07-24T07:00:00.000Z');
    });

    it('相对小时从参考时刻增加并保留分钟', () => {
      const withMinutes = new Date('2026-07-14T05:37:42.789Z');
      expect(
        computeScheduleRange('3个小时后', '上午', '', 60, withMinutes).startTime.toISOString(),
      ).toBe('2026-07-14T08:37:00.000Z');
    });

    it('自然月换算时把月末收敛到目标月最后一天', () => {
      const januaryLastDay = new Date('2027-01-31T04:00:00.000Z');
      expect(
        computeScheduleRange('一个月后', '上午', '', 60, januaryLastDay).startTime.toISOString(),
      ).toBe('2027-02-28T02:00:00.000Z');
    });

    it.each([
      ['几天后', '请补充具体数字'],
      ['多少个月后', '请补充具体数字'],
      ['0天后', '必须大于 0'],
      ['121个月后', '不能超过 120 个月'],
      ['3651天后', '不能超过 3650 天'],
      ['87601小时后', '不能超过 87600 小时'],
    ])('拒绝不确定或越界相对时间：%s', (dateText, error) => {
      expect(() => findScheduleDateExpression(dateText)).toThrow(error);
    });

    it('小时后又指定独立钟点时拒绝静默选择', () => {
      expect(() =>
        computeScheduleRange('3小时后', '下午3点', '', 60, reference),
      ).toThrow('小时后已经确定开始时刻');
    });

    it.each(['30分钟后', '半小时后', '20秒后'])(
      '分钟及以下相对单位不误建为今天：%s',
      (dateText) => {
        expect(() => findScheduleDateExpression(dateText)).toThrow(
          '暂不支持分钟后或秒后',
        );
      },
    );
  });

  describe('周几日期规则', () => {
    const wednesday = new Date('2026-07-15T05:00:00.000Z');

    it.each([
      ['周四', '2026-07-15T16:00:00.000Z'],
      ['周三', '2026-07-21T16:00:00.000Z'],
      ['周二', '2026-07-20T16:00:00.000Z'],
      ['下周三', '2026-07-21T16:00:00.000Z'],
      ['下下周三', '2026-07-28T16:00:00.000Z'],
      ['星期天', '2026-07-18T16:00:00.000Z'],
      ['礼拜日', '2026-07-18T16:00:00.000Z'],
    ])('%s 解析为确定日期', (text, expected) => {
      expect(resolveScheduleDate(text, wednesday).toISOString()).toBe(expected);
    });

    it('明确本周且日期已过时不顺延', () => {
      expect(() => resolveScheduleDate('本周二', wednesday)).toThrow(
        '日期已经过去',
      );
    });

    it('明确本周今天时仍使用当天', () => {
      expect(resolveScheduleDate('本周三', wednesday).toISOString()).toBe(
        '2026-07-14T16:00:00.000Z',
      );
    });

    it('周末要求明确周六或周日', () => {
      expect(() => resolveScheduleDate('周末', wednesday)).toThrow(
        '请明确周六或周日',
      );
    });
  });

  describe('两位年份规则', () => {
    it.each([
      ['27年5月7日', '2027-05-06T16:00:00.000Z'],
      ['27-5-7', '2027-05-06T16:00:00.000Z'],
      ['27/5/7', '2027-05-06T16:00:00.000Z'],
      ['28年6月16日', '2028-06-15T16:00:00.000Z'],
    ])('%s 映射为 20xx 年', (text, expected) => {
      expect(resolveScheduleDate(text, reference).toISOString()).toBe(expected);
      expect(findScheduleDateExpression(`创建${text}事项`)?.text).toBe(text);
    });

    it('27号仍表示当月日期而不是年份', () => {
      expect(resolveScheduleDate('27号', reference).toISOString()).toBe(
        '2026-07-26T16:00:00.000Z',
      );
    });
  });
});
