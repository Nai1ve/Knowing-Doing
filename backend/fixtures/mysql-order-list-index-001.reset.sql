DELETE FROM `orders`;

INSERT INTO `orders` (`id`, `user_id`, `status`, `created_at`, `total_amount`)
SELECT
  n + 1,
  IF(MOD(n, 10) = 0, 4242, 4000 + MOD(n, 100)),
  CASE MOD(n, 3) WHEN 0 THEN 'PAID' WHEN 1 THEN 'PENDING' ELSE 'CANCELLED' END,
  -- Keep the date dimension independent from user/status dimensions so the
  -- teaching query has representative rows on every fixture day.
  DATE_ADD('2026-07-01 00:00:00', INTERVAL MOD(FLOOR(n / 1000), 62) DAY) + INTERVAL MOD(n, 86400) SECOND,
  CAST(10 + MOD(n, 99000) / 100 AS DECIMAL(12, 2))
FROM `lab_seed_numbers`
WHERE n < 100000;
