import { parseScheduleUpdateIntent } from './schedule-update';

describe('schedule-update', () => {
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
