-- Migration 0033 (V5 follow-up F3): sales_transaction_type gains 'local'
-- (local sales: a person's name, "local", or a small lot). Additive only.
-- Existing rows are NOT touched: earlier local sales stay typed 'other'.
ALTER TYPE sales_transaction_type ADD VALUE IF NOT EXISTS 'local';
