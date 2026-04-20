import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface Article {
  id: string
  original_url: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: 'en' | 'ru'
  topics: string[] | null
  pub_date: string | null
  cover_image_url: string | null
  ru_title: string | null
  ru_text: string | null
  why_it_matters: string | null
  // Content engine v2
  lead: string | null
  summary: string[] | null
  card_teaser: string | null
  tg_teaser: string | null
  editorial_body: string | null
  editorial_model: string | null
  glossary: { term: string; definition: string }[] | null
  link_anchors: string[] | null
  article_tables: { headers: string[]; rows: string[][] }[] | null
  article_images: { src: string; alt: string }[] | null
  quality_ok: boolean
  quality_reason: string | null
  // ---
  dedup_hash: string | null
  enriched: boolean
  published: boolean
  tg_sent: boolean
  score: number
  slug: string | null
  created_at: string
  updated_at: string
}

export type ArticleInsert = Omit<Article, 'id' | 'created_at' | 'updated_at'>

let browserClientInstance: SupabaseClient | null = null

export function getBrowserClient(): SupabaseClient {
  if (browserClientInstance) return browserClientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase: отсутствуют SUPABASE_URL или SUPABASE_ANON_KEY')
  }

  browserClientInstance = createClient(url, key)
  return browserClientInstance
}

export function getServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error('Supabase: отсутствуют SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_KEY')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
