-- =====================================================================
-- Zentax Work Flow - 0003 : add the 'proposed' task status
--
-- Client-created tasks start as 'proposed' and must be accepted by the office
-- (Admin / Team Member) before they become 'open'.
--
-- IMPORTANT: run this file ON ITS OWN, BEFORE 0004. Postgres will not let a
-- brand-new enum value be *used* in the same transaction that adds it, so the
-- enum value gets its own migration. After this succeeds, run 0004.
-- =====================================================================

alter type public.task_status add value if not exists 'proposed';
