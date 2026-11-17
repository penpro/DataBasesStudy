-- One-time setup, run as a MySQL admin (for example: mysql -u root -p < db/setup.sql).
-- It creates the two databases and a user that can touch only those two.
-- Change the password here AND in .env (copy .env.example to .env).
-- The tables themselves are NOT made here: `npm run migrate` builds them from db/migrations/.

CREATE DATABASE IF NOT EXISTS cs330_study      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS cs330_study_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'cs330_app'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON cs330_study.*      TO 'cs330_app'@'localhost';
GRANT ALL PRIVILEGES ON cs330_study_test.* TO 'cs330_app'@'localhost';
