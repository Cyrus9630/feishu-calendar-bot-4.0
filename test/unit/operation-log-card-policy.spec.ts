import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('calendar_card_reference 行级安全策略', () => {
  const baselineSql = readFileSync(
    resolve(
      process.cwd(),
      'scripts/sql/2026-07-15-operation-log-card-policies.sql',
    ),
    'utf8',
  );
  const incrementalSql = readFileSync(
    resolve(
      process.cwd(),
      'scripts/sql/2026-07-19-calendar-card-reference-policy.sql',
    ),
    'utf8',
  );

  it.each([
    ['基线策略', baselineSql],
    ['增量策略', incrementalSql],
  ])('%s 在插入和更新条件中都允许卡片引用', (_label, sql) => {
    expect(sql).toContain("'calendar_card_reference'");
    expect(
      (sql.match(/calendar_card_reference/g) || []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('增量策略保留现有全部允许类型', () => {
    for (const type of [
      'message_process',
      'pending_action',
      'calendar_action',
      'agenda_action',
      'calendar_undo',
      'card_action',
      'calendar_created',
      'schedule_push',
      'daily_0900',
      'early_1700',
      'health_check',
      'case_calendar_request',
      'case_calendar_source',
      'desktop_pairing',
      'desktop_device',
    ]) {
      expect(incrementalSql).toContain(`'${type}'`);
    }
  });
});
