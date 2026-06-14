ALTER TABLE `servers` ADD `run_as_user` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `run_as_group` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `game_server_user` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `log_path` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `monitor_enabled` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `log_parser_enabled` integer;