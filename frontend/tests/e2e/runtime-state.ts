import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimeDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'runtime',
)

export async function resetRuntimeFiles(): Promise<void> {
  await writeFile(path.join(runtimeDir, 'dispatch-parameters.json'), '{}', 'utf8')
  await writeFile(path.join(runtimeDir, 'dispatch-rules.json'), '[]', 'utf8')
}
