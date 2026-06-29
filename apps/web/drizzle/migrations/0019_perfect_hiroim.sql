ALTER TABLE `server_update_state` ADD `desired_install_loader` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_install_mc_version` text;--> statement-breakpoint
ALTER TABLE `server_update_state` ADD `desired_install_loader_version` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `server_jvm_args` text;