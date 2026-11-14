import { useEffect, useState } from 'react'
import { t } from './i18n'

/**
 * The command line's manual (commands.js, the same text as `tetra help`): every app and its commands, found by any word.
 * An app's page is kept whole when its name or heading matches; otherwise only its commands that do.
 */
export function CommandsPage() {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { window.drive.commands.manual().then(setText) }, [])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const has = (s: string) => words.every(w => s.toLowerCase().includes(w))
  const shown = !words.length ? text : text.split('\n\n').map(part => {
    if (has(part.split('\n')[0])) return part
    const [head, ...blocks] = part.split(/\n(?= {2}tetra )/)
    const hits = blocks.filter(has)
    return hits.length ? [head, ...hits].join('\n') : ''
  }).filter(Boolean).join('\n\n')
  return (
    <div className="page-scroll">
      <header className="page-head"><h1>{t('commands.title')}</h1></header>
      <div className="manual-page">
        <p className="muted">{t('commands.intro')}</p>
        <input className="field" type="search" placeholder={t('commands.search')} value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <pre className="manual">{shown}</pre>
      </div>
    </div>
  )
}
