CREATE TABLE `guideline_acknowledgements` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`)
);
