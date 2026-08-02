import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { TG_CHANNEL_PRIMARY_SYSTEMD_CALENDAR_BY_SLOT } from '../../lib/tg-channel-schedule'

const vpsPath = (...parts: string[]) => resolve(process.cwd(), 'infra', 'vps', ...parts)

test('Telegram systemd units are exact, persistent Moscow primary timers', () => {
  const service = readFileSync(vpsPath('malakhov-tg-channel-post@.service'), 'utf8')
  assert.match(service, /EnvironmentFile=\/etc\/malakhov-ai-digest\/tg-channel-post\.env/)
  assert.match(service, /ExecStart=\/usr\/local\/libexec\/malakhov-tg-channel-post %i/)

  for (const [slot, calendar] of Object.entries(TG_CHANNEL_PRIMARY_SYSTEMD_CALENDAR_BY_SLOT)) {
    const timer = readFileSync(vpsPath(`malakhov-tg-channel-post-${slot}.timer`), 'utf8')
    assert.match(timer, new RegExp(`OnCalendar=${calendar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(timer, /Persistent=true/)
    assert.match(timer, /AccuracySec=1s/)
    assert.match(timer, /RandomizedDelaySec=0/)
    assert.match(timer, new RegExp(`Unit=malakhov-tg-channel-post@${slot}\\.service`))
  }
})

test('Telegram runner fails on non-2xx and avoids putting the authorization header in argv', () => {
  const runner = readFileSync(vpsPath('run-tg-channel-post.sh'), 'utf8')
  assert.match(runner, /curl --config "\$curl_config"/)
  assert.match(runner, /'fail'/)
  assert.match(runner, /'retry-all-errors'/)
  assert.doesNotMatch(runner, /curl .*Authorization: Bearer/)
})

test('GitHub workflow is delayed backup and manual dispatch is no-send unless explicitly enabled', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github', 'workflows', 'tg-channel-post-backup.yml'), 'utf8')
  assert.match(workflow, /name: Telegram Channel Post Backup/)
  assert.match(workflow, /default: false/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.send != true/)
  assert.match(workflow, /github\.event_name == 'schedule' \|\| inputs\.send == true/)
  assert.match(workflow, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/)
  assert.match(workflow, /concurrency:\n  group: telegram-channel-post-delivery/)
})
