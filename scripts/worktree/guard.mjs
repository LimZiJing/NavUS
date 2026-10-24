#!/usr/bin/env node
// PreToolUse hook: blocks file edits made in the shared checkout so work happens in a
// linked worktree. Set NAVUS_ALLOW_SHARED_EDITS=1 to bypass deliberately.
// Fails closed: malformed input or an unexpected git failure blocks the edit (exit 2).
// Only a confirmed non-repository path (for example the scratchpad) is allowed.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function block(message) {
  console.error(`Blocked by scripts/worktree/guard.mjs: ${message}`)
  process.exit(2)
}

if (process.env.NAVUS_ALLOW_SHARED_EDITS === '1') process.exit(0)

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch (error) {
  block(`could not parse the hook input (${error.message}). Set NAVUS_ALLOW_SHARED_EDITS=1 to bypass.`)
}

const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path
if (!target) process.exit(0)

// The file or its folders may not exist yet, so start from the nearest existing folder.
let dir = dirname(resolve(input.cwd ?? process.cwd(), target))
while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)

function git(...args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  if (result.error) block(`could not run git (${result.error.message}).`)
  return result
}

const topLevel = git('rev-parse', '--show-toplevel')
if (topLevel.status !== 0) {
  if (/not a git repository/i.test(topLevel.stderr)) process.exit(0)
  block(`git failed for ${dir}: ${topLevel.stderr.trim()}`)
}

const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir')
if (commonDir.status !== 0) block(`git failed for ${dir}: ${commonDir.stderr.trim()}`)

const top = resolve(topLevel.stdout.trim())
const shared = dirname(resolve(commonDir.stdout.trim()))
if (top === shared) {
  block(
    `${target} is in the shared checkout (${shared}). Create a fresh worktree from local main ` +
      '(git worktree add .claude/worktrees/<ticket> -b <branch> main), then make the change there. ' +
      'See docs/agents/workflow.md. Set NAVUS_ALLOW_SHARED_EDITS=1 only if the user asked for it.',
  )
}
