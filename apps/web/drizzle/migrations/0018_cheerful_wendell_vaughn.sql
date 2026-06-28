CREATE TABLE `server_snapshot` (
	`server_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`version` text,
	`size_bytes` integer,
	PRIMARY KEY(`server_id`, `snapshot_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server_update_event` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`from_version` text,
	`to_version` text,
	`status` text NOT NULL,
	`snapshot_id` text,
	`error` text,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_id` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_kind` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_version` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_artifact_url` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_artifact_hash_algo` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_artifact_hash` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_artifact_size` integer;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `apply_status` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `apply_error` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `last_applied_at` integer;