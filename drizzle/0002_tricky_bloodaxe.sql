ALTER TABLE `questions_pool` ADD `favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_pool_favorite` ON `questions_pool` (`favorite`);