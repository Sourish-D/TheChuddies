import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const dashboardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(dashboardDirectory, '..')
const pythonEnvironment = path.join(dashboardDirectory, '.venv')
const pythonExecutable = process.platform === 'win32'
  ? path.join(pythonEnvironment, 'Scripts', 'python.exe')
  : path.join(pythonEnvironment, 'bin', 'python')

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(pythonExecutable)) {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']
  const systemPython = candidates.find((candidate) => {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    return !result.error && result.status === 0
  })

  if (!systemPython) {
    console.error('Python 3 was not found. Install Python 3, then run "npm run setup" again.')
    process.exit(1)
  }

  run(systemPython, ['-m', 'venv', pythonEnvironment])
}

const pipCheck = spawnSync(pythonExecutable, ['-m', 'pip', '--version'], { stdio: 'ignore' })
if (pipCheck.error || pipCheck.status !== 0) {
  run(pythonExecutable, ['-m', 'ensurepip', '--upgrade'])
}

run(pythonExecutable, [
  '-m',
  'pip',
  'install',
  '-r',
  path.join(projectRoot, 'requirements-hls.txt'),
])
console.log('Python dependencies are ready.')
