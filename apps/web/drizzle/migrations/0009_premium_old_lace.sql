CREATE TABLE `player` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`user_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `player_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`kind` text NOT NULL,
	`identity_key` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_identity_kind_key_unq` ON `player_identity` (`kind`,`identity_key`);--> statement-breakpoint
CREATE TABLE `presence_events` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`type` text NOT NULL,
	`identity_kind` text,
	`identity_key` text,
	`player_name` text,
	`ip` text,
	`reason` text,
	`occurred_at` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presence_events_dedupe_key_unique` ON `presence_events` (`dedupe_key`);