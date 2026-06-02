CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL
);
