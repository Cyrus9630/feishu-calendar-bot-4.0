import type { CalendarEventRecord } from './feishu.service';
import {
  parseSingleUpdateSelection,
  rankUpdateCandidates,
  updateSearchWindow,
} from './calendar-update-search';

function event(
  eventId: string,
  summary: string,
  start: string,
): CalendarEventRecord {
  const startTime = new Date(start);
  return {
    eventId,
    summary,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
    allDay: false,
    attendeeCount: 0,
    hasMeeting: false,
  };
}

describe('calendar-update-search', () => {
  const reference = new Date('2026-07-19T09:00:00+08:00');

  it('使用连续且不重叠的30天和两年窗口', () => {
    expect(updateSearchWindow(reference, 'primary')).toEqual({
      start: reference,
      end: new Date('2026-08-18T09:00:00+08:00'),
    });
    expect(updateSearchWindow(reference, 'extended')).toEqual({
      start: new Date('2026-08-18T09:00:00+08:00'),
      end: new Date('2028-07-19T09:00:00+08:00'),
    });
  });

  it('完整标题优先于包含匹配', () => {
    const events = [
      event('included', '和月婷吃饭', '2026-07-20T19:00:00+08:00'),
      event('exact', '月婷吃饭', '2026-07-21T19:00:00+08:00'),
    ];
    expect(
      rankUpdateCandidates(events, '月婷吃饭').map((item) => item.eventId),
    ).toEqual(['exact']);
  });

  it('没有完整标题时按时间排列包含匹配并去重', () => {
    const later = event('later', '和月婷吃饭', '2026-07-22T19:00:00+08:00');
    const earlier = event(
      'earlier',
      '月婷吃饭安排',
      '2026-07-20T19:00:00+08:00',
    );
    expect(
      rankUpdateCandidates([later, earlier, later], '月婷吃饭').map(
        (item) => item.eventId,
      ),
    ).toEqual(['earlier', 'later']);
  });

  it.each(['', '1 2', '1、2', '0', '3', '一'])(
    '拒绝非单个有效序号：%s',
    (text) => {
      expect(() => parseSingleUpdateSelection(text, 2)).toThrow();
    },
  );

  it('接受单个有效序号并返回零基索引', () => {
    expect(parseSingleUpdateSelection(' 2 ', 3)).toBe(1);
  });
});
