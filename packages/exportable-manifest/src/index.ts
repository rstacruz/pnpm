import PnpmError from '@pnpm/error'
import { tryReadProjectManifest } from '@pnpm/read-project-manifest'
import { Dependencies, ProjectManifest } from '@pnpm/types'
import path = require('path')
import R = require('ramda')

// property keys that are copied from publishConfig into the manifest
const PUBLISH_CONFIG_WHITELIST = new Set([
  // manifest fields that may make sense to overwrite
  'bin',
  // https://github.com/stereobooster/package.json#package-bundlers
  'main',
  'module',
  'typings',
  'types',
  'exports',
  'browser',
  'esnext',
  'es2015',
  'unpkg',
  'umd:main',
])

export default async function makePublishManifest (dir: string, originalManifest: ProjectManifest) {
  const publishManifest = {
    ...originalManifest,
    dependencies: await makePublishDependencies(dir, originalManifest.dependencies),
    devDependencies: await makePublishDependencies(dir, originalManifest.devDependencies),
    optionalDependencies: await makePublishDependencies(dir, originalManifest.optionalDependencies),
    peerDependencies: await makePublishDependencies(dir, originalManifest.peerDependencies),
  }

  const { publishConfig } = originalManifest
  if (publishConfig) {
    Object.keys(publishConfig)
      .filter(key => PUBLISH_CONFIG_WHITELIST.has(key))
      .forEach(key => {
        publishManifest[key] = publishConfig[key]
      })
  }

  return publishManifest
}

async function makePublishDependencies (dir: string, dependencies: Dependencies | undefined) {
  if (!dependencies) return dependencies
  const publishDependencies: Dependencies = R.fromPairs(
    await Promise.all(
      Object.entries(dependencies)
        .map(async ([depName, depSpec]) => [
          depName,
          await makePublishDependency(depName, depSpec, dir),
        ])
    ) as any, // tslint:disable-line
  )
  return publishDependencies
}

async function makePublishDependency (depName: string, depSpec: string, dir: string) {
  if (!depSpec.startsWith('workspace:')) {
    return depSpec
  }
  if (depSpec === 'workspace:*') {
    const { manifest } = await tryReadProjectManifest(path.join(dir, 'node_modules', depName))
    if (!manifest || !manifest.version) {
      throw new PnpmError(
        'CANNOT_RESOLVE_WORKSPACE_PROTOCOL',
        `Cannot resolve workspace protocol of dependency "${depName}" ` +
          `because this dependency is not installed. Try running "pnpm install".`
      )
    }
    return manifest.version
  }
  return depSpec.substr(10)
}
