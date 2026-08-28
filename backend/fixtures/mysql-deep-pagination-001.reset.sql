DELETE FROM `events`;

INSERT INTO `events` (`id`, `created_at`, `event_type`, `payload`)
SELECT
  n + 1,
  DATE_ADD('2026-01-01 00:00:00', INTERVAL n SECOND),
  CASE MOD(n, 4) WHEN 0 THEN 'login' WHEN 1 THEN 'purchase' WHEN 2 THEN 'view' ELSE 'logout' END,
  CONCAT('event-payload-', n + 1)
FROM `lab_seed_numbers`
WHERE n < 100000;
