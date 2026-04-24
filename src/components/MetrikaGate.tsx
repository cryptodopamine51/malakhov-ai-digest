'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

const CONSENT_KEY = 'metrika-consent'

export default function MetrikaGate({ id }: { id: string }) {
  const [accepted, setAccepted] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setAccepted(localStorage.getItem(CONSENT_KEY) === 'yes')
    setReady(true)
  }, [])

  if (!ready) return null

  if (accepted) {
    return (
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${id},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`}
      </Script>
    )
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-base/95 px-4 py-3 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-muted">
          Используем Яндекс Метрику для статистики посещений. Скрипт загрузится только после согласия.
        </p>
        <button
          type="button"
          className="h-9 rounded border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          onClick={() => {
            localStorage.setItem(CONSENT_KEY, 'yes')
            setAccepted(true)
          }}
        >
          Разрешить
        </button>
      </div>
    </div>
  )
}
