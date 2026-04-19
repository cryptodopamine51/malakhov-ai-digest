import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function check() {
  const { count: total } = await supabase
    .from('articles').select('*', { count: 'exact', head: true })

  const { count: enriched } = await supabase
    .from('articles').select('*', { count: 'exact', head: true })
    .eq('enriched', true)

  const { count: published } = await supabase
    .from('articles').select('*', { count: 'exact', head: true })
    .eq('published', true)

  const { count: tgSent } = await supabase
    .from('articles').select('*', { count: 'exact', head: true })
    .eq('tg_sent', true)

  const { data: sample } = await supabase
    .from('articles').select('id, original_title, published, enriched, score, slug, ru_title, created_at')
    .limit(5)
    .order('created_at', { ascending: false })

  console.log('=== СОСТОЯНИЕ БД ===')
  console.log(`Всего статей:     ${total}`)
  console.log(`Обогащено:        ${enriched}`)
  console.log(`Опубликовано:     ${published}`)
  console.log(`Отправлено в TG:  ${tgSent}`)
  console.log('\n=== ПОСЛЕДНИЕ 5 СТАТЕЙ ===')
  console.log(JSON.stringify(sample, null, 2))
}

check().catch(console.error)
