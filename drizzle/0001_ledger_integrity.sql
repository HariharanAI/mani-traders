-- Ledger integrity rules enforced by the database itself.

-- 1) Every journal entry must balance (sum of debits = sum of credits) and have
--    at least two lines. Checked at COMMIT so lines can be inserted one by one.
CREATE OR REPLACE FUNCTION mt_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  v_entry uuid;
  v_dr numeric;
  v_cr numeric;
  v_n int;
BEGIN
  v_entry := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
    INTO v_dr, v_cr, v_n
    FROM journal_entry_lines WHERE journal_entry_id = v_entry;
  IF v_n < 2 OR v_dr <> v_cr OR v_dr = 0 THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (debit %, credit %, lines %)', v_entry, v_dr, v_cr, v_n;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER mt_journal_balanced
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mt_check_journal_balanced();
--> statement-breakpoint

-- 2) Journal lines are immutable: corrections are made with reversal entries.
CREATE OR REPLACE FUNCTION mt_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is immutable: % on % is not allowed. Use a reversal entry.', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mt_jel_immutable BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION mt_forbid_change();
--> statement-breakpoint

-- 3) Journal entries cannot be deleted, and only the is_reversed flag may change.
CREATE OR REPLACE FUNCTION mt_journal_entry_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journal entries cannot be deleted. Use a reversal entry.';
  END IF;
  IF NEW.entry_date <> OLD.entry_date OR NEW.memo <> OLD.memo OR NEW.source_type <> OLD.source_type
     OR NEW.entry_no <> OLD.entry_no OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'Journal entries are immutable. Use a reversal entry.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mt_je_guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION mt_journal_entry_guard();
--> statement-breakpoint

-- 4) Khata rows and payments may not be deleted.
CREATE TRIGGER mt_lt_nodelete BEFORE DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION mt_forbid_change();
--> statement-breakpoint
CREATE TRIGGER mt_payments_nodelete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION mt_forbid_change();
--> statement-breakpoint
CREATE TRIGGER mt_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION mt_forbid_change();
