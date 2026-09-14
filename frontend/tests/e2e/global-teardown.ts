import { resetRuntimeFiles } from './runtime-state'

export default async function globalTeardown(): Promise<void> {
  await resetRuntimeFiles()
}
