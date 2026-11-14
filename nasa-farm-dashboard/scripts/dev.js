import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { projectRoot, pythonExecutable, requirePythonEnvironment } from './python.js'

requirePythonEnvironment()

const dashboardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = [
  spawn(pythonExecutable, [
    '-m',
    'uvicorn',
    'scripts.ndvi_api:app',
    '--reload',
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
  ], { cwd: projectRoot, stdio: 'inherit' }),
  spawn(process.execPath, [
    path.join(dashboardDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
  ], { cwd: dashboardDirectory, stdio: 'inherit' }),
]

let stopping = false

function stopChildren(exitCode) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Could not start development service: ${error.message}`)
    stopChildren(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stopChildren(code ?? 1)
  })
}

process.on('SIGINT', () => stopChildren(130))
process.on('SIGTERM', () => stopChildren(143))
