import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const dashboardDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const projectRoot = path.resolve(dashboardDirectory, '..')
export const pythonExecutable = process.platform === 'win32'
  ? path.join(dashboardDirectory, '.venv', 'Scripts', 'python.exe')
  : path.join(dashboardDirectory, '.venv', 'bin', 'python')

export function requirePythonEnvironment() {
  if (!existsSync(pythonExecutable)) {
    console.error('Python environment not found. Run "npm run setup" first.')
    process.exit(1)
  }
}
