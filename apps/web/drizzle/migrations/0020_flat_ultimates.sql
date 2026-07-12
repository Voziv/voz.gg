ALTER TABLE `server_update_state` ADD `available_major_version` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `notified_major_version` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `major_update_policy` text;