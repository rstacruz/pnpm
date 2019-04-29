import readImporterManifest from '@pnpm/read-importer-manifest'
import writeImporterManifest from '@pnpm/write-importer-manifest'
import path = require('path')
import {
  mutateModules,
  uninstall,
} from 'supi'
import createStoreController from '../createStoreController'
import findWorkspacePackages, { arrayOfLocalPackagesToMap } from '../findWorkspacePackages'
import { PnpmOptions } from '../types'

export default async function uninstallCmd (
  input: string[],
  opts: PnpmOptions,
) {
  const store = await createStoreController(opts)
  const uninstallOpts = Object.assign(opts, {
    store: store.path,
    storeController: store.ctrl,
  })
  if (opts.lockfileDirectory === opts.prefix) {
    const { manifest, fileName } = await readImporterManifest(opts.prefix)
    const newManifest = await uninstall(manifest, input, uninstallOpts)
    await writeImporterManifest(path.join(opts.prefix, fileName), newManifest)
    return
  }
  uninstallOpts['localPackages'] = opts.linkWorkspacePackages && opts.workspacePrefix
    ? arrayOfLocalPackagesToMap(await findWorkspacePackages(opts.workspacePrefix))
    : undefined
  const currentManifest = await readImporterManifest(opts.prefix)
  const [mutationResult] = await mutateModules(
    [
      {
        bin: opts.bin,
        dependencyNames: input,
        manifest: currentManifest.manifest,
        mutation: 'uninstallSome',
        prefix: opts.prefix,
      },
    ],
    uninstallOpts,
  )
  await writeImporterManifest(path.join(opts.prefix, currentManifest.fileName), mutationResult.manifest)
}
