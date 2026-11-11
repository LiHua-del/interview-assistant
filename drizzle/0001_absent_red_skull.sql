ALTER TABLE `questions_pool` ADD `answer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions_pool` ADD `source_file` text;--> statement-breakpoint
ALTER TABLE `questions_pool` ADD `duplicates` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `questions_pool` ADD `created_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_pool_category` ON `questions_pool` (`category`);