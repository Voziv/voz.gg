CREATE TABLE `group_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_tag_name_unq` ON `group_tag` (`name`);--> statement-breakpoint
CREATE TABLE `player_group_tag` (
	`player_id` text NOT NULL,
	`group_tag_id` text NOT NULL,
	PRIMARY KEY(`player_id`, `group_tag_id`),
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_tag_id`) REFERENCES `group_tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `player` ADD `status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `is_bot` integer DEFAULT false NOT NULL;
