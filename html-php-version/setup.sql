-- 360 Logistics Database Setup
-- =======================================

CREATE DATABASE IF NOT EXISTS `360_logistics` 
DEFAULT CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `360_logistics`;

-- KV Store Table (mimics Supabase KV store)
CREATE TABLE IF NOT EXISTS `kv_store` (
  `key` VARCHAR(255) PRIMARY KEY,
  `value` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_updated (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions Table (for admin/driver sessions)
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(255) UNIQUE NOT NULL,
  `user_type` ENUM('admin', 'driver') NOT NULL,
  `user_id` VARCHAR(100) NOT NULL,
  `user_email` VARCHAR(255),
  `user_role` VARCHAR(50),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NOT NULL,
  `last_activity` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_id (`session_id`),
  INDEX idx_expires (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded Files Table (for tracking uploads)
CREATE TABLE IF NOT EXISTS `uploaded_files` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `file_path` VARCHAR(500) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_type` VARCHAR(100),
  `file_size` INT,
  `uploaded_by` VARCHAR(100),
  `assignment_id` VARCHAR(100),
  `document_type` VARCHAR(100),
  `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_assignment (`assignment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity Log Table (optional - for audit trail)
CREATE TABLE IF NOT EXISTS `activity_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_type` ENUM('admin', 'driver') NOT NULL,
  `user_id` VARCHAR(100) NOT NULL,
  `action` VARCHAR(255) NOT NULL,
  `details` TEXT,
  `ip_address` VARCHAR(45),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (`user_type`, `user_id`),
  INDEX idx_created (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
