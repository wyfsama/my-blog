#!/usr/bin/env node
/**
 * Local publish loop for Obsidian workflow:
 * 1) validate content (自动报错)
 * 2) commit content files only
 * 3) push → Vercel / CI will publish
 *
 * Usage:
 *   node scripts/publish-content.mjs
 *   node scripts/publish-content.mjs --watch
 */
import { spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WATCH = process.argv.includes('--watch')
const CONTENT_GLOBS = [
  'src/content/posts',
  'src/content/attachments',
  'src/content/projects',
]

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  })
  if (res.stdout?.trim()) process.stdout.write(res.stdout)
  if (res.stderr?.trim()) process.stderr.write(res.stderr)
  return res.status ?? 1
}

function publishOnce() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 校验内容...`)
  if (run('pnpm', ['validate']) !== 0) {
    console.error('校验失败，已阻止提交/推送。')
    return false
  }

  run('git', ['add', '--', ...CONTENT_GLOBS])
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const files = (staged.stdout || '').trim()
  if (!files) {
    console.log('没有内容变更，跳过。')
    return true
  }

  console.log('待发布文件:\n' + files)
  const msg = `content: publish ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
  if (run('git', ['commit', '-m', msg]) !== 0) {
    console.error('commit 失败')
    return false
  }
  if (run('git', ['push']) !== 0) {
    console.error('push 失败（检查远程权限 / 网络）')
    return false
  }
  console.log('已推送。等待 CI 校验 + Vercel 发布。')
  return true
}

publishOnce()

if (WATCH) {
  console.log('\n监听 Obsidian 内容变更（posts / attachments / projects）...')
  let timer = null
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(() => publishOnce(), 2500)
  }
  for (const rel of CONTENT_GLOBS) {
    const abs = path.join(ROOT, rel)
    try {
      watch(abs, { recursive: true }, kick)
    } catch (err) {
      console.warn(`无法监听 ${rel}:`, err.message)
    }
  }
}
