import PnpmError from '@pnpm/error'
import {
  getLockfileImporterId,
  readCurrentLockfile,
  readWantedLockfile,
} from '@pnpm/lockfile-file'
import outdated, {
  forPackages as outdatedForPackages, OutdatedPackage,
} from '@pnpm/outdated'
import storePath from '@pnpm/store-path'
import { PackageJson, Registries } from '@pnpm/types'
import chalk from 'chalk'
import stripColor = require('strip-color')
import table = require('text-table')
import createLatestVersionGetter from '../createLatestVersionGetter'
import { readImporterManifestOnly } from '../readImporterManifest'
import semverDiff, { SEMVER_CHANGE } from '@pnpm/semver-diff'

const CHANGE_PRIORITIES: Record<SEMVER_CHANGE, number> = {
  fix: 1,
  feature: 2,
  breaking: 3,
  unknown: 3,
}

export type OutdatedPackageWithVersionDiff = OutdatedPackage & { change: SEMVER_CHANGE, diff: [string[], string[]] }

export default async function (
  args: string[],
  opts: {
    alwaysAuth: boolean,
    ca?: string,
    cert?: string,
    engineStrict?: boolean,
    fetchRetries: number,
    fetchRetryFactor: number,
    fetchRetryMaxtimeout: number,
    fetchRetryMintimeout: number,
    global: boolean,
    httpsProxy?: string,
    independentLeaves: boolean,
    key?: string,
    localAddress?: string,
    networkConcurrency: number,
    offline: boolean,
    prefix: string,
    proxy?: string,
    rawNpmConfig: object,
    registries: Registries,
    lockfileDirectory?: string,
    store?: string,
    strictSsl: boolean,
    tag: string,
    userAgent: string,
  },
  command: string,
) {
  const packages = [
    {
      manifest: await readImporterManifestOnly(opts.prefix, opts),
      path: opts.prefix,
    },
  ]
  const { outdatedPackages } = (await outdatedDependenciesOfWorkspacePackages(packages, args, opts))[0]

  if (!outdatedPackages.length) return

  const columnNames = [
    'Package',
    'Current',
    'Latest',
  ].map((txt) => chalk.underline(txt))
  let columnFns: Array<(outdatedPkg: OutdatedPackageWithVersionDiff) => string> = [
    renderPackageName,
    ({ current, wanted }) => {
      let output = current || 'missing'
      if (current === wanted) return output
      return `${output} (wanted ${wanted})`
    },
    renderLatest,
  ]
  console.log(
    table([
      columnNames,
      ...outdatedPackages
        .map((outdatedPkg) => outdatedPkg.latest ? { ...outdatedPkg, ...semverDiff(outdatedPkg.wanted, outdatedPkg.latest)} : outdatedPkg)
        .sort((pkg1, pkg2) => sortBySemverChange(pkg1 as OutdatedPackageWithVersionDiff, pkg2 as OutdatedPackageWithVersionDiff))
        .map((outdatedPkg) => columnFns.map((fn) => fn(outdatedPkg as OutdatedPackageWithVersionDiff))),
    ], {
      stringLength: (s: string) => stripColor(s).length,
    }),
  )
}

export function renderPackageName ({ belongsTo, packageName }: OutdatedPackageWithVersionDiff) {
  switch (belongsTo) {
    case 'devDependencies': return `${packageName} ${chalk.dim('(dev)')}`
    case 'optionalDependencies': return `${packageName} ${chalk.dim('(optional)')}`
    default: return packageName
  }
}

export function renderLatest ({ latest, wanted, change, diff }: OutdatedPackageWithVersionDiff) {
  if (!latest) return ''

  let highlight!: ((v: string) => string)
  switch (change) {
    case 'feature':
      highlight = chalk.yellowBright.bold
      break
    case 'fix':
      highlight = chalk.greenBright.bold
      break
    default:
      highlight = chalk.redBright.bold
      break
  }
  const versionTuples = [
    ...diff[0],
    ...diff[1].map((versionTuple) => highlight(versionTuple)),
  ]
  if (versionTuples.length === 3) return versionTuples.join('.')
  return versionTuples.slice(0, 3).join('.') + '-' + versionTuples.slice(3).join('.')
}

export function sortBySemverChange (outdated1: OutdatedPackageWithVersionDiff, outdated2: OutdatedPackageWithVersionDiff) {
  return pkgPriority(outdated1) - pkgPriority(outdated2)
}

function pkgPriority (pkg: OutdatedPackageWithVersionDiff) {
  return pkg.change && CHANGE_PRIORITIES[pkg.change] || 3
}

export async function outdatedDependenciesOfWorkspacePackages (
  pkgs: Array<{path: string, manifest: PackageJson}>,
  args: string[],
  opts: {
    alwaysAuth: boolean,
    ca?: string,
    cert?: string,
    fetchRetries: number,
    fetchRetryFactor: number,
    fetchRetryMaxtimeout: number,
    fetchRetryMintimeout: number,
    global: boolean,
    httpsProxy?: string,
    independentLeaves: boolean,
    key?: string,
    localAddress?: string,
    networkConcurrency: number,
    offline: boolean,
    prefix: string,
    proxy?: string,
    rawNpmConfig: object,
    registries: Registries,
    lockfileDirectory?: string,
    store?: string,
    strictSsl: boolean,
    tag: string,
    userAgent: string,
  },
) {
  const lockfileDirectory = opts.lockfileDirectory || opts.prefix
  const currentLockfile = await readCurrentLockfile(lockfileDirectory, { ignoreIncompatible: false })
  const wantedLockfile = await readWantedLockfile(lockfileDirectory, { ignoreIncompatible: false }) || currentLockfile
  if (!wantedLockfile) {
    throw new PnpmError('OUTDATED_NO_LOCKFILE', 'No lockfile in this directory. Run `pnpm install` to generate one.')
  }
  const store = await storePath(opts.prefix, opts.store)
  const getLatestVersion = createLatestVersionGetter({
    ...opts,
    lockfileDirectory,
    store,
  })
  return Promise.all(pkgs.map(async ({ manifest, path }) => {
    const optsForOutdated = {
      currentLockfile,
      getLatestVersion,
      lockfileDirectory,
      manifest,
      prefix: path,
      wantedLockfile,
    }
    return {
      manifest,
      outdatedPackages: args.length
        ? await outdatedForPackages(args, optsForOutdated)
        : await outdated(optsForOutdated),
      prefix: getLockfileImporterId(lockfileDirectory, path),
    }
  }))
}
