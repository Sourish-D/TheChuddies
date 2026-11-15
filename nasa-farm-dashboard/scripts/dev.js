import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { projectRoot, pythonExecutable, requirePythonEnvironment } from './python.js'

requirePythonEnvironment()

const dashboardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'chuddies-data-'))
const hlsDataDirectory = path.join(temporaryDataDirectory, 'hls-data')
const legacyHlsDataDirectory = path.join(projectRoot, 'hls-data')
const children = [
  spawn(pythonExecutable, [
    '-m',
    'uvicorn',
    'scripts.ndvi_api:app',
    '--reload',
    '--reload-dir',
    path.join(projectRoot, 'scripts'),
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      HLS_DATA_DIR: hlsDataDirectory,
      HLS_DATA_CLEANUP_BY_LAUNCHER: '1',
    },
  }),
  spawn(process.execPath, [
    path.join(dashboardDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
  ], { cwd: dashboardDirectory, stdio: 'inherit' }),
]

let stopping = false
let closedChildren = 0
let cleanedUp = false

function stopChildren(exitCode) {
  if (!stopping) {
    stopping = true
    process.exitCode = exitCode
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
  if (closedChildren === children.length && !cleanedUp) {
    cleanedUp = true
    for (const directory of [temporaryDataDirectory, legacyHlsDataDirectory]) {
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch (error) {
        console.error(`Could not remove temporary data at ${directory}: ${error.message}`)
        process.exitCode = 1
      }
    }
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Could not start development service: ${error.message}`)
    stopChildren(1)
  })
  child.on('close', (code) => {
    closedChildren += 1
    if (!stopping) stopChildren(code ?? 1)
    else stopChildren(process.exitCode ?? 0)
  })
}

process.on('SIGINT', () => stopChildren(130))
process.on('SIGTERM', () => stopChildren(143))
