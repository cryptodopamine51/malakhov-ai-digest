import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), 'malakhov-ai-keys.env') })

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID!
  const bucket = process.env.R2_BUCKET!
  const publicBase = process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, '')
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

  const key = `_smoke-test/hello-${Date.now()}.txt`
  const body = `r2 smoke test ${new Date().toISOString()}`

  console.log('[1] PUT', key, '→', bucket)
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }))
  console.log('    OK')

  const publicUrl = `${publicBase}/${key}`
  console.log('[2] GET (public)', publicUrl)
  const res = await fetch(publicUrl)
  const text = await res.text()
  console.log('    status', res.status, '| match:', text === body)

  console.log('[3] cleanup DELETE')
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  console.log('    OK')

  if (res.status !== 200 || text !== body) {
    console.error('SMOKE TEST FAILED')
    process.exit(1)
  }
  console.log('SMOKE TEST PASSED')
}

main().catch((e) => {
  console.error('ERROR:', e?.message ?? e)
  process.exit(1)
})
