ALTER TABLE `servers` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `server_control_enabled` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `server_working_dir` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `start_command` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `restart_schedule` text;