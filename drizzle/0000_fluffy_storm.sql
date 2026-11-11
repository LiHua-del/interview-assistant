CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`resume_file` text,
	`resume_format` text NOT NULL,
	`resume_raw_text` text NOT NULL,
	`resume_parsed` text NOT NULL,
	`risk_report` text NOT NULL,
	`status` text DEFAULT '待面' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`company` text,
	`jd_snapshot` text NOT NULL,
	`rubric` text NOT NULL,
	`question_config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `question_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`candidate_id` text,
	`is_base` integer DEFAULT false NOT NULL,
	`questions` text NOT NULL,
	`config_snapshot` text NOT NULL,
	`reusable_prompt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_qsets_job` ON `question_sets` (`job_id`,`is_base`);--> statement-breakpoint
CREATE TABLE `questions_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`tags` text NOT NULL,
	`question` text NOT NULL,
	`difficulty` integer DEFAULT 3 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`metrics` text NOT NULL,
	`verdict` text NOT NULL,
	`attribution` text NOT NULL,
	`interviewer_analysis` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`job_id` text NOT NULL,
	`question_set_id` text,
	`seq` integer DEFAULT 1 NOT NULL,
	`transcript` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_rounds_candidate` ON `rounds` (`candidate_id`);