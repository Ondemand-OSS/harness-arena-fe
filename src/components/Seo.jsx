import { useEffect } from 'react'

const SITE_NAME = 'Harness Arena'
const PRODUCTION_SITE_URL = 'https://harness-arena.ai'

const PAGES = {
  '/leaderboard': {
    title: 'AI Coding Harness Leaderboard',
    description: 'Compare AI coding harnesses by Elo rating, battle record, and blind human judging on real-world tasks.',
  },
  '/harness': {
    title: 'AI Coding Harness Roster',
    description: 'Explore the AI coding harnesses competing in Harness Arena and compare their blind-evaluation results.',
  },
  '/methodology': {
    title: 'Methodology for AI Harness Evaluation',
    description: 'Learn how Harness Arena runs blind head-to-head AI harness battles and turns human judgments into Elo rankings.',
  },
}

function setMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setCanonical(url) {
  let element = document.head.querySelector('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }
  element.setAttribute('href', url)
}

export default function Seo({ pathname }) {
  useEffect(() => {
    const page = PAGES[pathname]
    const indexable = Boolean(page)
    const title = page ? `${page.title} | ${SITE_NAME}` : `${SITE_NAME} — Blind AI Harness Battles`
    const description = page
      ? page.description
      : 'Blind head-to-head battles between AI coding harnesses on real tasks, judged by people and ranked by Elo.'
    // Keep staging deployments from publishing canonicals that compete with
    // the public site. VITE_SITE_URL remains an escape hatch for a future
    // custom production domain.
    const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.replace(/\/$/, '')
    const origin = configuredSiteUrl || PRODUCTION_SITE_URL
    const canonicalUrl = `${origin}${pathname}`

    document.title = title
    setMeta('name', 'description', description)
    setMeta('name', 'robots', indexable ? 'index,follow' : 'noindex,nofollow')
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', canonicalUrl)
    setMeta('name', 'twitter:card', 'summary')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    setCanonical(canonicalUrl)

    let structuredData = document.getElementById('seo-structured-data')
    if (!structuredData) {
      structuredData = document.createElement('script')
      structuredData.id = 'seo-structured-data'
      structuredData.type = 'application/ld+json'
      document.head.appendChild(structuredData)
    }
    structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      description,
      url: origin,
    })
  }, [pathname])

  return null
}
