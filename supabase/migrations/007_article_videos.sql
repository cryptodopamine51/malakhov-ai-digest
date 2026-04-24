alter table public.articles
  add column if not exists article_videos jsonb;

create or replace function public.apply_anthropic_batch_item_result(
  p_batch_item_id uuid,
  p_enrich_status text,
  p_publish_status text,
  p_score integer,
  p_cover_image_url text,
  p_original_text text,
  p_ru_title text,
  p_lead text,
  p_summary text[],
  p_card_teaser text,
  p_tg_teaser text,
  p_editorial_body text,
  p_editorial_model text,
  p_glossary jsonb,
  p_link_anchors text[],
  p_article_tables jsonb,
  p_article_images jsonb,
  p_article_videos jsonb,
  p_quality_ok boolean,
  p_quality_reason text,
  p_slug text,
  p_publish_ready_at timestamptz,
  p_result_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns table(applied boolean, noop boolean, state text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item anthropic_batch_items%rowtype;
  v_article articles%rowtype;
  v_attempt_no integer;
begin
  select *
  into v_item
  from anthropic_batch_items
  where id = p_batch_item_id
  for update;

  if not found then
    return query select false, false, 'missing_item';
    return;
  end if;

  if v_item.status = 'applied' then
    return query select false, true, 'already_applied';
    return;
  end if;

  if v_item.status not in ('batch_result_ready', 'applying', 'apply_failed_retriable') then
    return query select false, false, 'item_not_ready';
    return;
  end if;

  begin
    update anthropic_batch_items
    set
      status = 'applying',
      apply_attempts = apply_attempts + 1,
      last_apply_error = null,
      last_apply_error_code = null,
      updated_at = now()
    where id = p_batch_item_id;

    select *
    into v_article
    from articles
    where id = v_item.article_id
    for update;

    if not found then
      update anthropic_batch_items
      set
        status = 'apply_failed_terminal',
        last_apply_error = 'article not found',
        last_apply_error_code = 'missing_article',
        updated_at = now()
      where id = p_batch_item_id;

      return query select false, false, 'missing_article';
      return;
    end if;

    v_attempt_no := coalesce(v_article.attempt_count, 0) + 1;

    update articles
    set
      enrich_status = p_enrich_status,
      publish_status = p_publish_status,
      publish_ready_at = p_publish_ready_at,
      score = coalesce(p_score, score),
      cover_image_url = p_cover_image_url,
      original_text = p_original_text,
      ru_title = p_ru_title,
      ru_text = p_editorial_body,
      lead = p_lead,
      summary = p_summary,
      card_teaser = p_card_teaser,
      tg_teaser = p_tg_teaser,
      editorial_body = p_editorial_body,
      editorial_model = p_editorial_model,
      glossary = case
        when p_glossary is null then null
        when jsonb_typeof(p_glossary) = 'array' and jsonb_array_length(p_glossary) = 0 then null
        else p_glossary
      end,
      link_anchors = case
        when p_link_anchors is null or array_length(p_link_anchors, 1) is null then null
        else p_link_anchors
      end,
      article_tables = case
        when p_article_tables is null then null
        when jsonb_typeof(p_article_tables) = 'array' and jsonb_array_length(p_article_tables) = 0 then null
        else p_article_tables
      end,
      article_images = case
        when p_article_images is null then null
        when jsonb_typeof(p_article_images) = 'array' and jsonb_array_length(p_article_images) = 0 then null
        else p_article_images
      end,
      article_videos = case
        when p_article_videos is null then null
        when jsonb_typeof(p_article_videos) = 'array' and jsonb_array_length(p_article_videos) = 0 then null
        else p_article_videos
      end,
      quality_ok = p_quality_ok,
      quality_reason = nullif(p_quality_reason, ''),
      slug = p_slug,
      enriched = true,
      published = coalesce(p_quality_ok, false),
      current_batch_item_id = null,
      claim_token = null,
      processing_by = null,
      lease_expires_at = null,
      last_error = nullif(p_error_message, ''),
      last_error_code = nullif(p_error_code, ''),
      processing_finished_at = now(),
      updated_at = now()
    where id = v_article.id;

    insert into article_attempts (
      article_id,
      batch_item_id,
      stage,
      attempt_no,
      worker_id,
      claim_token,
      started_at,
      finished_at,
      duration_ms,
      result_status,
      error_code,
      error_message,
      payload
    )
    select
      v_article.id,
      v_item.id,
      'enrich',
      v_attempt_no,
      coalesce(v_article.processing_by, 'batch-collector'),
      v_article.claim_token,
      coalesce(v_article.processing_started_at, now()),
      now(),
      greatest(0, floor(extract(epoch from (now() - coalesce(v_article.processing_started_at, now()))) * 1000))::integer,
      p_result_status,
      nullif(p_error_code, ''),
      nullif(p_error_message, ''),
      jsonb_build_object('batch_id', v_item.batch_id, 'batch_item_id', v_item.id)
    where not exists (
      select 1
      from article_attempts attempts
      where attempts.stage = 'enrich'
        and attempts.batch_item_id = v_item.id
    );

    update anthropic_batch_items
    set
      status = 'applied',
      applied_at = now(),
      updated_at = now()
    where id = p_batch_item_id;

    return query select true, false, 'applied';
    return;
  exception
    when others then
      update anthropic_batch_items
      set
        status = 'apply_failed_retriable',
        last_apply_error = sqlerrm,
        last_apply_error_code = 'apply_exception',
        updated_at = now()
      where id = p_batch_item_id;

      raise;
  end;
end;
$$;
