-- confidence was initialised to 0.5 and never updated; it added a constant
-- bias to _activation() and was otherwise dead schema.
ALTER TABLE memory_index DROP COLUMN confidence;
