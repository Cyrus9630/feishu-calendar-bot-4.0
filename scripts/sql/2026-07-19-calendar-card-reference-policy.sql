BEGIN;

ALTER POLICY robot_webhook_insert ON operation_log
  WITH CHECK (
    type::text = ANY (ARRAY[
      'message_process',
      'pending_action',
      'calendar_action',
      'agenda_action',
      'calendar_undo',
      'calendar_card_reference',
      'card_action',
      'calendar_created',
      'schedule_push',
      'daily_0900',
      'early_1700',
      'health_check',
      'case_calendar_request',
      'case_calendar_source',
      'desktop_pairing',
      'desktop_device'
    ]::text[])
    AND status::text = ANY (ARRAY[
      'processing',
      'claimed',
      'success',
      'fail'
    ]::text[])
  );

ALTER POLICY robot_webhook_update ON operation_log
  USING (
    type::text = ANY (ARRAY[
      'message_process',
      'pending_action',
      'calendar_action',
      'agenda_action',
      'calendar_undo',
      'calendar_card_reference',
      'card_action',
      'calendar_created',
      'schedule_push',
      'daily_0900',
      'early_1700',
      'health_check',
      'case_calendar_request',
      'case_calendar_source',
      'desktop_pairing',
      'desktop_device'
    ]::text[])
  )
  WITH CHECK (
    type::text = ANY (ARRAY[
      'message_process',
      'pending_action',
      'calendar_action',
      'agenda_action',
      'calendar_undo',
      'calendar_card_reference',
      'card_action',
      'calendar_created',
      'schedule_push',
      'daily_0900',
      'early_1700',
      'health_check',
      'case_calendar_request',
      'case_calendar_source',
      'desktop_pairing',
      'desktop_device'
    ]::text[])
    AND status::text = ANY (ARRAY[
      'processing',
      'claimed',
      'success',
      'fail'
    ]::text[])
  );

COMMIT;
