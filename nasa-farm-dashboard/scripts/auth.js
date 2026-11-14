import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { projectRoot, pythonExecutable, requirePythonEnvironment } from './python.js'

requirePythonEnvironment()

const result = spawnSync(
  pythonExecutable,
  [path.join(projectRoot, 'scripts', 'earthdata_login.py')],
  { cwd: projectRoot, stdio: 'inherit' },
)

if (result.error) {
  console.error(`Could not start Earthdata login: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
