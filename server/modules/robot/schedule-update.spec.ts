import {
  parseScheduleUpdateIntent,
  resolveScheduleUpdateTitle,
} from './schedule-update';

describe('schedule-update', () => {
  it.each(['修改下周六吃饭 黄色', '修改下周二 脱口秀 黄色'])(
    '前置修改不被切成修：%s',
    (source) => {
      const intent = parseScheduleUpdateIntent(source);
      expect(intent.target.title).toBe(
        source.includes('吃饭') ? '吃饭' : '脱口秀',
      );
      expect(intent.changes.title).toBe('');
    },
  );
  it('同时设置颜色和时间时，人名补入原事项', () => {
    const intent = parseScheduleUpdateIntent('周四吃饭 改为 黄色 晚上 李女士');
    expect(intent.target.title).toBe('吃饭');
    expect(intent.changes).toEqual({
      dateText: '',
      timeText: '晚上',
      title: '李女士',
      titleMode: 'append',
    });
    expect(resolveScheduleUpdateTitle('吃饭 项目沟通', intent.changes)).toBe(
      '吃饭 项目沟通 李女士',
    );
    expect(resolveScheduleUpdateTitle('吃饭 李女士', intent.changes)).toBe(
      '吃饭 李女士',
    );
  });
  it.each([
    '下周六吃饭 修改为 王先生 吃饭 黄色',
    '下周六吃饭修改为王先生吃饭黄色。',
  ])('改名保留人名并剥离颜色：%s', (source) => {
    const intent = parseScheduleUpdateIntent(source);
    expect(intent.target.title).toBe('吃饭');
    expect(intent.changes.title.replace(/\s/g, '')).toBe('王先生吃饭');
  });
  it('明确改名并改时间时按新标题替换', () => {
    const intent = parseScheduleUpdateIntent(
      '明天吃饭改名为下午3点王先生 项目签约 黄色',
    );
    expect(resolveScheduleUpdateTitle('吃饭', intent.changes)).toBe(
      '王先生 项目签约',
    );
  });
  it('仅颜色设置伴随人名时仍保留原事项', () => {
    const intent = parseScheduleUpdateIntent('周四吃饭改为黄色 王先生');
    expect(resolveScheduleUpdateTitle('吃饭', intent.changes)).toBe(
      '吃饭 王先生',
    );
  });
  it('转正式不是把事项改名为正式', () => {
    const intent = parseScheduleUpdateIntent('明天客户会议改为正式');
    expect(resolveScheduleUpdateTitle('【暂定】客户会议', intent.changes)).toBe(
      '【暂定】客户会议',
    );
  });
  it.each(['11月11日前一周', '11月11日两月后', '一个星期后', '两月后'])(
    '修改保留完整周/月表达：%s',
    (dateText) => {
      const intent = parseScheduleUpdateIntent(
        `把11月11日复查改到${dateText}下午3:40`,
        '复查',
      );
      expect(intent?.changes).toEqual({
        dateText,
        timeText: '下午3:40',
        title: '',
      });
    },
  );
  it('修改保留完整的锚点偏移日期，不混入标题', () => {
    expect(
      parseScheduleUpdateIntent(
        '把11月11日复查改到11月11日之前16天下午3:40',
        '复查',
      ),
    ).toEqual({
      target: { dateText: '11月11日', timeText: '', title: '复查' },
      changes: {
        dateText: '11月11日之前16天',
        timeText: '下午3:40',
        title: '',
      },
    });
  });
  it('分离原日期和新日期时间', () => {
    expect(
      parseScheduleUpdateIntent('把17号体检改到18号上午8点', '体检'),
    ).toEqual({
      target: { dateText: '17号', timeText: '', title: '体检' },
      changes: { dateText: '18号', timeText: '上午8点', title: '' },
    });
  });

  it('分离目标时间和修改后的时间', () => {
    expect(
      parseScheduleUpdateIntent('把17号上午7点体检改到8点', '体检'),
    ).toEqual({
      target: { dateText: '17号', timeText: '上午7点', title: '体检' },
      changes: { dateText: '', timeText: '8点', title: '' },
    });
  });

  it('分离旧标题和新标题', () => {
    expect(
      parseScheduleUpdateIntent('把17号体检改名为年度体检', '年度体检'),
    ).toEqual({
      target: { dateText: '17号', timeText: '', title: '体检' },
      changes: { dateText: '', timeText: '', title: '年度体检' },
    });
  });

  it('重复日程范围词不混入目标事项', () => {
    expect(
      parseScheduleUpdateIntent('把7月28日交房租全部改到下午3点', '交房租'),
    ).toEqual({
      target: { dateText: '7月28日', timeText: '', title: '交房租' },
      changes: { dateText: '', timeText: '下午3点', title: '' },
    });
  });

  it('把改加日期简写识别为修改标记', () => {
    expect(parseScheduleUpdateIntent('月婷吃饭改周三', '月婷吃饭')).toEqual({
      target: { dateText: '', timeText: '', title: '月婷吃饭' },
      changes: { dateText: '周三', timeText: '', title: '' },
    });
  });

  it('不把标题中的普通改字当作修改标记', () => {
    expect(
      parseScheduleUpdateIntent('改造项目改名为年度改造项目', '年度改造项目'),
    ).toEqual({
      target: { dateText: '', timeText: '', title: '改造项目' },
      changes: { dateText: '', timeText: '', title: '年度改造项目' },
    });
  });
});
