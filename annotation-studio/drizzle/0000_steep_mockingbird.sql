CREATE TABLE `answer_keys` (
	`domain` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`answers` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_document_content` ON `documents` (`project_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `email`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_project` ON `memberships` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `qualification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`answers` text NOT NULL,
	`correct` integer NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `qualifications` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`passed_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload` text NOT NULL,
	`qualification_version` text NOT NULL,
	`saved_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_submission_per_document` ON `submissions` (`project_id`,`document_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_per_user` ON `submissions` (`user_id`,`request_id`);