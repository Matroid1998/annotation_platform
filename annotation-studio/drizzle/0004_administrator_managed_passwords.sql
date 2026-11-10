-- Passwords are assigned by the administrator. Retain the legacy column for
-- compatibility without rebuilding accounts or disturbing existing sessions.
UPDATE local_accounts SET must_change_password = 0 WHERE must_change_password <> 0;
