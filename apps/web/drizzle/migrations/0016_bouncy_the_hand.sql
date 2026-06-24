CREATE TABLE `server_update_state` (
	`server_id` text PRIMARY KEY NOT NULL,
	`available_version` text,
	`available_published_at` integer,
	`checked_at` integer,
	`last_error` text,
	`notified_version` text,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `servers` ADD `update_source` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `modpack_provider` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `modpack_id` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `update_channel` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `pinned_version` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `update_policy` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `current_version` text;