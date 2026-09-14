import { resetRuntimeFiles } from './runtime-state'

export default async function globalSetup(): Promise<void> {
  await resetRuntimeFiles()
}
