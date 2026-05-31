CREATE TABLE `server_agent` (
	`server_id` text PRIMARY KEY NOT NULL,
	`enrollment_token_hash` text,
	`agent_token_hash` text,
	`enrolled_at` integer,
	`last_seen_at` integer,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server_status` (
	`server_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`players` integer,
	`max_players` integer,
	`version` text,
	`latency_ms` integer,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
