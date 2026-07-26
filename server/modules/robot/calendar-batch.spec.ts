import {
  isSelectionText,
  parseBatchEnvelope,
  parseSelectionIndexes,
} from './calendar-batch';

describe('calendar-batch', () => {
  it.each([
    ['批量创建\n17号上午体检\n18号下午开会', ['17号上午体检', '18号下午开会']],
    ['添加：17号上午体检；18号下午开会', ['17号上午体检', '18号下午开会']],
    [
      '批量创建 1. 17号上午体检 2. 18号下午开会',
      ['17号上午体检', '18号下午开会'],
    ],
    ['17号上午体检，18号下午开会', ['17号上午体检', '18号下午开会']],
    ['17号上午体检、下午开会', ['17号上午体检', '17号下午开会']],
    [
      '明天上午体检，下午开会，晚上吃饭',
      ['明天上午体检', '明天下午开会', '明天晚上吃饭'],
    ],
    [
      '明天上午体检，18号下午开会，晚上吃饭',
      ['明天上午体检', '18号下午开会', '18号晚上吃饭'],
    ],
    [
      '下下周三上午体检，星期四下午开会',
      ['下下周三上午体检', '星期四下午开会'],
    ],
  ])('拆分批量创建：%s', (text, items) => {
    expect(parseBatchEnvelope(text)).toEqual({
      isBatch: true,
      action: 'create',
      items,
    });
  });

  it('继承批量删除操作并移除每项动词', () => {
    expect(parseBatchEnvelope('删除17号体检；删除18号开庭')).toEqual({
      isBatch: true,
      action: 'cancel',
      items: ['17号体检', '18号开庭'],
    });
  });

  it('不把包含普通逗号的单项地点拆成批量', () => {
    expect(parseBatchEnvelope('17号到北京市,朝阳区开会')).toEqual({
      isBatch: false,
      action: 'create',
      items: ['17号到北京市,朝阳区开会'],
    });
  });

  it('拒绝同一批次混合创建和删除', () => {
    expect(() => parseBatchEnvelope('创建17号体检；删除18号开庭')).toThrow(
      '不能混合',
    );
  });

  it('拒绝超过20项', () => {
    const text = Array.from(
      { length: 21 },
      (_, index) => `${index + 1}. ${index + 1}号事项`,
    ).join('\n');
    expect(() => parseBatchEnvelope(text)).toThrow('最多处理20项');
  });

  it.each([
    ['1', [1]],
    ['1、3、5-7', [1, 3, 5, 6, 7]],
    ['1 2 3', [1, 2, 3]],
    ['第2,4项', [2, 4]],
    ['3，1，3', [3, 1]],
  ])('解析删除序号：%s', (text, indexes) => {
    expect(parseSelectionIndexes(text, 8)).toEqual(indexes);
  });

  it.each(['0', '9', '3-1', '1、abc', ''])('拒绝无效删除序号：%s', (text) => {
    expect(() => parseSelectionIndexes(text, 8)).toThrow();
  });

  it.each(['1', '1 2 3', '1、2、3', '2-5', '第2项'])(
    '识别独立发送的候选序号：%s',
    (text) => expect(isSelectionText(text)).toBe(true),
  );

  it.each(['17号', '17号上午体检', '删除1号日程', '1号开庭'])(
    '不把普通日程文本误判为候选序号：%s',
    (text) => expect(isSelectionText(text)).toBe(false),
  );
});
