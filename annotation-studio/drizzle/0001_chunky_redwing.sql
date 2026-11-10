CREATE TABLE `answer_key_versions` (
	`domain` text NOT NULL,
	`version` text NOT NULL,
	`answers` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` text NOT NULL,
	PRIMARY KEY(`domain`, `version`)
);
