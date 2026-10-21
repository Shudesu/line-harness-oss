-- Persist the exact standard-multicast request before LINE may accept it.
-- NULL leaves historical receipts untouched; no past rows are reconstructed.
ALTER TABLE broadcasts ADD COLUMN pending_batch_id TEXT;
ALTER TABLE broadcasts ADD COLUMN pending_batch TEXT;
