CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`identity_kind` text NOT NULL,
	`identity_key` text NOT NULL,
	`trigger` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_log_lookup_idx` ON `notification_log` (`server_id`,`identity_key`,`trigger`);--> statement-breakpoint
ALTER TABLE `player` ADD `muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `discord_webhook_url` text;--> statement-breakpoint
CREATE INDEX `presence_events_server_id_identity_key_idx` ON `presence_events` (`server_id`,`identity_key`);