CREATE TABLE `recordings` (
	`player` text NOT NULL,
	`segment` integer NOT NULL,
	`object_key` text NOT NULL,
	PRIMARY KEY(`player`, `segment`),
	FOREIGN KEY (`player`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
