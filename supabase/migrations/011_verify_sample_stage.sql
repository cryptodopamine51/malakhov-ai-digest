-- Migration 011: allow separate live-sample verification attempts.

alter table article_attempts
  drop constraint if exists article_attempts_stage_check;

alter table article_attempts
  add constraint article_attempts_stage_check
  check (stage in ('enrich', 'verify', 'verify_sample'));
