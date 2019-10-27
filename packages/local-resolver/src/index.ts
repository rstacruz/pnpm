import PnpmError from '@pnpm/error'
import { readImporterManifestOnly } from '@pnpm/read-importer-manifest'
import {
  DirectoryResolution,
  ResolveResult,
  TarballResolution
} from '@pnpm/resolver-base'
import { DependencyManifest } from '@pnpm/types'
import fs = require('graceful-fs')
import ssri = require('ssri')
import parsePref from './parsePref'

/**
 * Resolves a package hosted on the local filesystem
 */
export default async function resolveLocal (
  wantedDependency: {pref: string},
  opts: {
    prefix: string,
    lockfileDir?: string,
  },
): Promise<(ResolveResult & ({
  id: string,
  normalizedPref: string,
  resolution: TarballResolution,
} | {
  id: string,
  normalizedPref: string,
  package: DependencyManifest,
  resolution: DirectoryResolution,
})) | null> {
  const spec = parsePref(wantedDependency.pref, opts.prefix, opts.lockfileDir || opts.prefix)
  if (!spec) return null

  if (spec.type === 'file') {
    return {
      id: spec.id,
      normalizedPref: spec.normalizedPref,
      resolution: {
        integrity: await getFileIntegrity(spec.fetchSpec),
        tarball: spec.id,
      },
      resolvedVia: 'local-filesystem',
    }
  }

  let localDependencyManifest!: DependencyManifest
  try {
    localDependencyManifest = await readImporterManifestOnly(spec.fetchSpec) as DependencyManifest
  } catch (internalErr) {
    switch (internalErr.code) {
      case 'ENOTDIR': {
        throw new PnpmError('NOT_PACKAGE_DIRECTORY',
          `Could not install from "${spec.fetchSpec}" as it is not a directory.`)
      }
      case 'ENOENT': {
        throw new PnpmError('DIRECTORY_HAS_NO_PACKAGE_JSON',
          `Could not install from "${spec.fetchSpec}" as it does not contain a package.json file.`)
      }
      default: {
        throw internalErr
      }
    }
  }
  return {
    id: spec.id,
    normalizedPref: spec.normalizedPref,
    package: localDependencyManifest,
    resolution: {
      directory: spec.dependencyPath,
      type: 'directory',
    },
    resolvedVia: 'local-filesystem',
  }
}

async function getFileIntegrity (filename: string) {
  return (await ssri.fromStream(fs.createReadStream(filename))).toString()
}
