/**
 * Validate Obsidian / content posts frontmatter before publish.
 * Fail fast with readable errors (自动报错).
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const POSTS_DIR = path.join(ROOT, 'src/content/posts')

const REQUIRED = ['title', 'description', 'pubDate']

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (/\.(md|mdx)$/i.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    return { data: null, error: '缺少 YAML frontmatter（必须以 --- 开头）' }
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) {
    return { data: null, error: 'frontmatter 未正确结束（缺少结尾 ---）' }
  }
  const block = raw.slice(4, end).trim()
  const data = {}
  let currentKey = null

  for (const line of block.split(/\r?\n/)) {
    if (/^\s*-\s+/.test(line) && currentKey) {
      const value = line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, '')
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(value)
      continue
    }
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!match) continue
    currentKey = match[1]
    const rawValue = match[2].trim()
    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      data[currentKey] = rawValue === '' ? [] : ''
      continue
    }
    data[currentKey] = rawValue.replace(/^["']|["']$/g, '')
  }

  return { data, error: null }
}

function isValidDate(value) {
  if (!value) return false
  const d = new Date(value)
  return !Number.isNaN(d.getTime())
}

async function resolveCover(postFile, cover) {
  if (!cover) return null
  if (cover.startsWith('http://') || cover.startsWith('https://')) return null
  const abs = path.resolve(path.dirname(postFile), cover)
  try {
    await stat(abs)
    return null
  } catch {
    return `cover 文件不存在: ${cover}`
  }
}

async function main() {
  let files
  try {
    files = await walk(POSTS_DIR)
  } catch {
    console.error(`找不到文章目录: ${POSTS_DIR}`)
    process.exit(1)
  }

  if (files.length === 0) {
    console.warn('警告: 没有找到任何文章（*.md / *.mdx）')
    return
  }

  const errors = []

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const raw = await readFile(file, 'utf8')
    const { data, error } = parseFrontmatter(raw)
    if (error) {
      errors.push(`${rel}: ${error}`)
      continue
    }
    for (const key of REQUIRED) {
      if (data[key] === undefined || data[key] === '' || (Array.isArray(data[key]) && data[key].length === 0)) {
        errors.push(`${rel}: 缺少必填字段 \`${key}\``)
      }
    }
    if (data.pubDate && !isValidDate(data.pubDate)) {
      errors.push(`${rel}: pubDate 不是合法日期（当前: ${data.pubDate}）`)
    }
    if (data.draft !== undefined && !['true', 'false', true, false].includes(data.draft) && data.draft !== 'true' && data.draft !== 'false') {
      // keep soft — YAML bool as string is fine
    }
    const coverErr = await resolveCover(file, data.cover)
    if (coverErr) errors.push(`${rel}: ${coverErr}`)
  }

  if (errors.length) {
    console.error(`\n内容校验失败（${errors.length}）:\n`)
    for (const err of errors) console.error(`  ✖ ${err}`)
    console.error('\n请修好后再推送 / 发布。\n')
    process.exit(1)
  }

  console.log(`内容校验通过：${files.length} 篇文章`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
