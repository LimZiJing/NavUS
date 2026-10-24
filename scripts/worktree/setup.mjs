#!/usr/bin/env node
// Prepares a linked worktree: junctions node_modules from the shared checkout and
// copies ignored env files. Idempotent; never overwrites an existing destination.
// Usage: node scripts/worktree/setup.mjs [--unlink]
// Run --unlink before `git worktree remove` so the shared node_modules is untouched.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const LINKED_DIRS = ['node_modules', 'frontend/node_modules', 'backend/node_modules']
const COPIED_FILES = ['.env', '.env.local', 'backend/.env']

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

const worktree = resolve(git('rev-parse', '--show-toplevel'))
const shared = dirname(resolve(git('rev-parse', '--path-format=absolute', '--git-common-dir')))

if (worktree === shared) {
  console.log('worktree-setup: shared checkout, nothing to do.')
  process.exit(0)
}

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

// Unlike existsSync, this is true for a dangling symlink, so a destination is never written through a link.
const occupied = (path) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

if (process.argv.includes('--unlink')) {
  for (const rel of LINKED_DIRS) {
    const dest = join(worktree, rel)
    if (isLink(dest)) {
      rmSync(dest, { recursive: false, force: true })
      console.log(`worktree-setup: unlinked ${rel}`)
    }
  }
  process.exit(0)
}

for (const rel of LINKED_DIRS) {
  const src = join(shared, rel)
  const dest = join(worktree, rel)
  if (!existsSync(src)) console.log(`worktree-setup: skip ${rel} (missing in shared checkout)`)
  else if (occupied(dest)) console.log(`worktree-setup: skip ${rel} (already present)`)
  else {
    symlinkSync(src, dest, 'junction')
    console.log(`worktree-setup: linked ${rel}`)
  }
}

for (const rel of COPIED_FILES) {
  const src = join(shared, rel)
  const dest = join(worktree, rel)
  if (!existsSync(src)) console.log(`worktree-setup: skip ${rel} (missing in shared checkout)`)
  else if (occupied(dest)) console.log(`worktree-setup: skip ${rel} (already present)`)
  else {
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
    console.log(`worktree-setup: copied ${rel}`)
  }
}
