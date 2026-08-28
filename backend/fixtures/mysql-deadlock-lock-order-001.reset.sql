DELETE FROM `accounts`;

INSERT INTO `accounts` (`id`, `account_name`, `balance`, `version`)
VALUES
  (1, 'order-reserve-a', 1000.00, 1),
  (2, 'order-reserve-b', 1000.00, 1);
