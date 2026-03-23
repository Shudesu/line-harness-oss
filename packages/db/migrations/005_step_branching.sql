-- Add branching support to scenario steps
ALTER TABLE scenario_steps ADD COLUMN condition_type TEXT;
-- condition_type: null (always execute), 'tag_exists', 'tag_not_exists', 'metadata_equals', 'metadata_not_equals'

ALTER TABLE scenario_steps ADD COLUMN condition_value TEXT;
-- For tag conditions: tag_id
-- For metadata conditions: JSON like {"key": "purchased", "value": "true"}

ALTER TABLE scenario_steps ADD COLUMN next_step_on_false INTEGER;
-- If condition fails, jump to this step_order instead of the next sequential step
-- null = skip this step and continue to next
