#!/usr/bin/env node
// Renders the profile stats cards in the same palette as profile/hero.svg.
// Run with a token that can read public profile data: GITHUB_TOKEN=... node scripts/stats.mjs

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOGIN = process.env.PROFILE_LOGIN ?? 'henrychea'
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const C = {
  bg: '#0e0e10',
  panel: '#131315',
  grid: '#1b1b1d',
  line: '#4d4632',
  yellow: '#facc15',
  red: '#ef4444',
  cream: '#e5e1e4',
  muted: '#9a9078',
  dim: '#6f6a5a',
}

const HEAT = [C.grid, C.line, C.muted, C.yellow, C.red]
const BARS = [C.yellow, C.red, C.muted, C.cream, '#6c5700', '#ffb3ad']

const QUERY = `query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date } }
      }
    }
  }
}`

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])

const fmt = (value) => Number(value).toLocaleString('en-US')

async function load() {
  if (!TOKEN) throw new Error('Set GITHUB_TOKEN (or GH_TOKEN)')
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': LOGIN },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors) {
    throw new Error(`GitHub API: ${response.status} ${JSON.stringify(payload.errors ?? payload)}`)
  }
  return payload.data.user
}

function quartiles(counts) {
  const active = counts.filter(Boolean).sort((a, b) => a - b)
  if (active.length === 0) return [1, 2, 3, 4]
  const at = (q) => active[Math.min(active.length - 1, Math.floor(active.length * q))]
  return [at(0.25), at(0.5), at(0.75), at(0.9)]
}

function level(count, cuts) {
  if (!count) return 0
  if (count <= cuts[0]) return 1
  if (count <= cuts[1]) return 2
  if (count <= cuts[2]) return 3
  return 4
}

function frame(width, height, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" ${extra}>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${C.grid}" stroke-width="1"/>
    </pattern>
    <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.yellow}" stop-opacity="0"/>
      <stop offset="40%" stop-color="${C.yellow}" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="${C.red}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${C.red}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${C.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>`
}

function corners(width, height) {
  return `<path d="M 20 40 L 20 16 L 44 16" fill="none" stroke="${C.red}" stroke-width="2.5"/>
  <path d="M ${width - 20} 40 L ${width - 20} 16 L ${width - 44} 16" fill="none" stroke="${C.red}" stroke-width="2.5"/>
  <path d="M 20 ${height - 32} L 20 ${height - 16} L 44 ${height - 16}" fill="none" stroke="${C.red}" stroke-width="2.5"/>
  <path d="M ${width - 20} ${height - 32} L ${width - 20} ${height - 16} L ${width - 44} ${height - 16}" fill="none" stroke="${C.red}" stroke-width="2.5"/>
  <rect x="20" y="16" width="${width - 40}" height="3" fill="url(#scan)"/>`
}

function header(width, left, right) {
  return `<rect x="40" y="38" width="7" height="7" fill="${C.yellow}"/>
  <text x="54" y="46" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="10.5" letter-spacing="1.8" fill="${C.muted}">${esc(left)}</text>
  <text x="${width - 40}" y="46" text-anchor="end" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="10.5" letter-spacing="1.8" fill="${C.yellow}">${esc(right)}</text>`
}

function statsCard(user, synced) {
  const width = 1000
  const height = 260
  const weeks = user.contributionsCollection.contributionCalendar.weeks
  const days = weeks.flatMap((week) => week.contributionDays)
  const cuts = quartiles(days.map((day) => day.contributionCount))
  const cell = 10
  const gap = 3
  const originX = 40
  const originY = 78

  const heat = weeks
    .map((week, x) =>
      week.contributionDays
        .map((day, y) => {
          const fill = HEAT[level(day.contributionCount, cuts)]
          return `<rect x="${originX + x * (cell + gap)}" y="${originY + y * (cell + gap)}" width="${cell}" height="${cell}" fill="${fill}"><title>${esc(day.date)}: ${day.contributionCount}</title></rect>`
        })
        .join(''),
    )
    .join('')

  const legend = HEAT.map((fill, index) => `<rect x="${originX + index * (cell + gap)}" y="${originY + 7 * (cell + gap) + 8}" width="${cell}" height="${cell}" fill="${fill}"/>`).join('')

  const stars = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0)
  const rows = [
    ['COMMITS', user.contributionsCollection.totalCommitContributions],
    ['PULL REQUESTS', user.pullRequests.totalCount],
    ['ISSUES', user.issues.totalCount],
    ['STARS', stars],
    ['REPOS', user.repositories.totalCount],
    ['FOLLOWERS', user.followers.totalCount],
  ]

  return `${frame(width, height, `aria-label="GitHub stats for ${esc(LOGIN)}"`)}
  <rect x="20" y="16" width="${width - 40}" height="${height - 32}" fill="${C.panel}" stroke="${C.yellow}" stroke-width="1.2"/>
  <rect x="30" y="26" width="${width - 60}" height="${height - 52}" fill="none" stroke="${C.line}" stroke-opacity="0.7"/>
  ${corners(width, height)}
  ${header(width, 'SYS.STATS // LAST_12_MONTHS', `[${fmt(user.contributionsCollection.contributionCalendar.totalContributions)} CONTRIBUTIONS]`)}
  ${heat}
  ${legend}
  <text x="${originX + 5 * (cell + gap) + 4}" y="${originY + 7 * (cell + gap) + 16}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">LESS → MORE</text>
  ${rows
    .map(([label, value], index) => {
      const y = 92 + index * 21
      return `<text x="760" y="${y}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9.5" letter-spacing="1.2" fill="${C.muted}">${label}</text>
      <text x="${width - 40}" y="${y}" text-anchor="end" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="16" fill="${C.cream}">${fmt(value)}</text>`
    })
    .join('')}
  <text x="40" y="${height - 26}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">SYNCED ${esc(synced)}</text>
  <text x="${width - 40}" y="${height - 26}" text-anchor="end" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">GITHUB.COM/${esc(LOGIN.toUpperCase())}</text>
</svg>`
}

function langsCard(user, synced) {
  const width = 490
  const height = 290
  const totals = new Map()
  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages?.edges ?? []) {
      totals.set(edge.node.name, (totals.get(edge.node.name) ?? 0) + edge.size)
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, 5)
  const other = sorted.slice(5).reduce((sum, [, size]) => sum + size, 0)
  const rows = other > 0 ? [...top, ['Other', other]] : top
  const total = rows.reduce((sum, [, size]) => sum + size, 0) || 1

  let x = 24
  const bar = rows
    .map(([, size], index) => {
      const segment = (size / total) * 442
      const rect = `<rect x="${x}" y="64" width="${Math.max(segment - 1, 0.5)}" height="20" fill="${BARS[index % BARS.length]}"/>`
      x += segment
      return rect
    })
    .join('')

  const legend = rows
    .map(([name, size], index) => {
      const y = 116 + index * 22
      return `<rect x="24" y="${y - 9}" width="8" height="8" fill="${BARS[index % BARS.length]}"/>
      <text x="40" y="${y}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="11" fill="${C.cream}">${esc(name)}</text>
      <text x="${width - 24}" y="${y}" text-anchor="end" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="11" fill="${C.muted}">${((size / total) * 100).toFixed(1)}%</text>`
    })
    .join('')

  return `${frame(width, height, `aria-label="Languages across public repositories for ${esc(LOGIN)}"`)}
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="${C.panel}" stroke="${C.yellow}" stroke-width="1.2"/>
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="${C.line}" stroke-opacity="0.7"/>
  ${header(width, 'SYS.LANGS // PUBLIC_REPOS', 'BY BYTES')}
  ${bar}
  ${legend}
  <text x="24" y="${height - 18}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="0.8" fill="${C.muted}">SYNCED ${esc(synced)} · ${fmt(user.repositories.totalCount)} PUBLIC REPOS</text>
</svg>`
}

function streakCard(user, synced) {
  const width = 490
  const height = 290
  const days = user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .filter((day) => day.date <= synced)
  const counts = days.map((day) => day.contributionCount)
  const cuts = quartiles(counts)

  let longest = 0
  let run = 0
  for (const count of counts) {
    run = count > 0 ? run + 1 : 0
    longest = Math.max(longest, run)
  }

  let index = counts.length - 1
  if (counts[index] === 0) index -= 1
  let current = 0
  while (index >= 0 && counts[index] > 0) {
    current += 1
    index -= 1
  }

  const active = counts.filter(Boolean).length
  const last30 = days.slice(-30)

  return `${frame(width, height, `aria-label="Contribution streak for ${esc(LOGIN)}"`)}
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="${C.panel}" stroke="${C.yellow}" stroke-width="1.2"/>
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="none" stroke="${C.line}" stroke-opacity="0.7"/>
  ${header(width, 'SYS.STREAK // CONTRIBUTIONS', `[${active} ACTIVE DAYS]`)}
  <text x="24" y="104" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9.5" letter-spacing="1.2" fill="${C.muted}">CURRENT STREAK</text>
  <text x="24" y="164" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="46" fill="${C.yellow}">${current}</text>
  <text x="24" y="186" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">DAYS</text>
  <line x1="240" y1="88" x2="240" y2="186" stroke="${C.line}" stroke-opacity="0.7"/>
  <text x="264" y="104" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9.5" letter-spacing="1.2" fill="${C.muted}">LONGEST STREAK</text>
  <text x="264" y="164" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="46" fill="${C.cream}">${longest}</text>
  <text x="264" y="186" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">DAYS</text>
  <text x="24" y="212" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="1" fill="${C.dim}">LAST 30 DAYS</text>
  ${last30
    .map((day, position) => `<rect x="${24 + position * 11}" y="222" width="8" height="8" fill="${HEAT[level(day.contributionCount, cuts)]}"><title>${esc(day.date)}: ${day.contributionCount}</title></rect>`)
    .join('')}
  <text x="24" y="${height - 18}" font-family="'SFMono-Regular', Menlo, Consolas, monospace" font-size="9" letter-spacing="0.8" fill="${C.muted}">SYNCED ${esc(synced)}</text>
</svg>`
}

const user = await load()
const synced = new Date().toISOString().slice(0, 10)
await mkdir(join(ROOT, 'profile'), { recursive: true })
await writeFile(join(ROOT, 'profile', 'stats.svg'), statsCard(user, synced))
await writeFile(join(ROOT, 'profile', 'langs.svg'), langsCard(user, synced))
await writeFile(join(ROOT, 'profile', 'streak.svg'), streakCard(user, synced))
console.log(`stats.svg + langs.svg + streak.svg written for ${LOGIN} (${synced})`)
