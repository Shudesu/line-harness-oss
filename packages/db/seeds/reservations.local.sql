-- Local reservation seed.
-- This file is safe to re-run. It creates one sample resource, menu, weekly schedule,
-- and two weeks of concrete slots for LIFF booking smoke tests.

INSERT OR IGNORE INTO google_calendar_connections
  (id, calendar_id, auth_type, access_token, refresh_token, api_key, is_active, created_at, updated_at)
VALUES
  (
    'gcal_reservation_default',
    'primary',
    'api_key',
    NULL,
    NULL,
    NULL,
    1,
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
  );

INSERT OR IGNORE INTO reservation_resources
  (
    id,
    line_account_id,
    name,
    description,
    default_duration_minutes,
    default_capacity,
    default_line_capacity,
    default_external_capacity,
    default_buffer_capacity,
    google_calendar_connection_id,
    slot_interval_minutes,
    timezone,
    is_active,
    display_order,
    metadata,
    created_at,
    updated_at
  )
VALUES
  (
    'res_blueberry',
    NULL,
    'ブルーベリー摘み取り',
    'LIFF予約の動作確認用リソース',
    60,
    10,
    6,
    4,
    0,
    'gcal_reservation_default',
    60,
    'Asia/Tokyo',
    1,
    10,
    '{}',
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
  );

INSERT OR IGNORE INTO reservation_menus
  (
    id,
    resource_id,
    name,
    description,
    duration_minutes,
    unit_type,
    min_people,
    max_people,
    price_adult,
    price_child,
    form_fields,
    is_active,
    display_order,
    metadata,
    created_at,
    updated_at
  )
VALUES
  (
    'menu_blueberry_60',
    'res_blueberry',
    'ブルーベリー摘み取り 60分',
    'MVP用の単一slotメニュー',
    60,
    'person',
    1,
    6,
    1800,
    900,
    '[]',
    1,
    10,
    '{}',
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
    strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
  );

INSERT OR IGNORE INTO reservation_schedules
  (
    id,
    resource_id,
    day_of_week,
    start_time,
    end_time,
    slot_interval_minutes,
    default_capacity,
    default_line_capacity,
    default_external_capacity,
    default_buffer_capacity,
    is_active,
    created_at,
    updated_at
  )
VALUES
  ('sched_blueberry_mon', 'res_blueberry', 1, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_tue', 'res_blueberry', 2, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_wed', 'res_blueberry', 3, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_thu', 'res_blueberry', 4, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_fri', 'res_blueberry', 5, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_sat', 'res_blueberry', 6, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('sched_blueberry_sun', 'res_blueberry', 0, '09:00', '15:00', 60, 10, 6, 4, 0, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));

WITH RECURSIVE
  days(offset, date_value) AS (
    SELECT 1, date('now', '+1 day', '+9 hours')
    UNION ALL
    SELECT offset + 1, date(date_value, '+1 day')
    FROM days
    WHERE offset < 14
  ),
  hours(hour_value) AS (
    SELECT 9
    UNION ALL
    SELECT hour_value + 1
    FROM hours
    WHERE hour_value < 14
  )
INSERT OR IGNORE INTO reservation_slots
  (
    id,
    resource_id,
    date,
    start_at,
    end_at,
    total_capacity,
    line_capacity,
    external_capacity,
    buffer_capacity,
    reserved_count,
    line_reserved_count,
    external_reserved_count,
    status,
    created_at,
    updated_at
  )
SELECT
  'slot_blueberry_' || replace(days.date_value, '-', '') || '_' || printf('%02d00', hours.hour_value),
  'res_blueberry',
  days.date_value,
  days.date_value || 'T' || printf('%02d:00:00+09:00', hours.hour_value),
  days.date_value || 'T' || printf('%02d:00:00+09:00', hours.hour_value + 1),
  10,
  6,
  4,
  0,
  0,
  0,
  0,
  'open',
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
FROM days
CROSS JOIN hours;
