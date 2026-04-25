'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import {
  CONSENT_CHANGED_EVENT,
  hasAnalyticsConsent,
  readConsent,
  type ConsentRecord,
} from '../../lib/consent'

interface AnalyticsProps {
  metrikaId: string
}

/**
 * Подгружает Яндекс Метрику только после явного согласия на аналитические cookies.
 * До решения пользователя ничего не загружаем — это требование 152-ФЗ и логика баннера.
 */
export default function Analytics({ metrikaId }: AnalyticsProps) {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const sync = (record: ConsentRecord | null) => setAllowed(hasAnalyticsConsent(record))
    sync(readConsent())

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ConsentRecord>).detail
      sync(detail ?? readConsent())
    }
    window.addEventListener(CONSENT_CHANGED_EVENT, handler)
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, handler)
  }, [])

  if (!allowed) return null

  return (
    <Script id="yandex-metrika" strategy="lazyOnload">
      {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${metrikaId},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`}
    </Script>
  )
}
