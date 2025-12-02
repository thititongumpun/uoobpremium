DROP TABLE IF EXISTS Customers;
CREATE TABLE IF NOT EXISTS Customers (
	customer_id INTEGER PRIMARY KEY,
	name TEXT,
	discord_id TEXT);
INSERT INTO Customers (customer_id, name, discord_id)
	VALUES
	(1, 'เต้ย', '145353208368332800'),
	(2, 'บอส', '371666482674794507'),
	(3, 'โอ๊ต', '191903847214481408'),
	(4, 'มือพิคาด', '319034154006347777');


DROP TABLE IF EXISTS Payments;
CREATE TABLE IF NOT EXISTS Payments (
  payment_id INTEGER PRIMARY KEY,
  year INTEGER,
  month INTEGER,
  is_paid BIT,
  customer_id INTEGER,
  FOREIGN KEY(customer_id) REFERENCES Customers(customer_id) ON DELETE CASCADE
);
INSERT INTO Payments (payment_id, year, month, is_paid, customer_id)
VALUES
  (1, 2025, 12, 1, 1),
  (2, 2025, 12, 1, 2),
  (3, 2025, 12, 1, 3);


UPDATE Payments
SET is_paid = 0
WHERE customer_id = 3;
