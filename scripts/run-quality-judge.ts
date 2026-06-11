import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { runDailyQualityJudge } from '../pipeline/article-quality'

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !hasFlag('dry-run')) {
    throw new Error('ANTHROPIC_API_KEY missing')
  }

  const result = await runDailyQualityJudge({
    supabase: getServerClient(),
    model: arg('model') ?? process.env.QUALITY_JUDGE_MODEL,
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    dryRun: hasFlag('dry-run'),
  })
  console.log(`[quality-judge] judged=${result.judged} skipped=${result.skipped}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
