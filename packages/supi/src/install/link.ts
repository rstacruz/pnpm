import { ENGINE_NAME } from '@pnpm/constants'
import {
  rootLogger,
  stageLogger,
  statsLogger,
} from '@pnpm/core-loggers'
import {
  filterLockfileByImporters,
} from '@pnpm/filter-lockfile'
import hoist from '@pnpm/hoist'
import { Lockfile } from '@pnpm/lockfile-file'
import logger from '@pnpm/logger'
import { prune } from '@pnpm/modules-cleaner'
import { IncludedDependencies } from '@pnpm/modules-yaml'
import {
  DependenciesGraph,
  DependenciesGraphNode,
  ProjectToLink,
} from '@pnpm/resolve-dependencies'
import { StoreController } from '@pnpm/store-controller-types'
import symlinkDependency, { symlinkDirectRootDependency } from '@pnpm/symlink-dependency'
import {
  HoistedDependencies,
  Registries,
} from '@pnpm/types'
import path = require('path')
import fs = require('mz/fs')
import pLimit = require('p-limit')
import R = require('ramda')

const brokenModulesLogger = logger('_broken_node_modules')

export default async function linkPackages (
  projects: ProjectToLink[],
  depGraph: DependenciesGraph,
  opts: {
    currentLockfile: Lockfile
    dryRun: boolean
    force: boolean
    hoistedDependencies: HoistedDependencies
    hoistedModulesDir: string
    hoistPattern?: string[]
    publicHoistPattern?: string[]
    include: IncludedDependencies
    lockfileDir: string
    makePartialCurrentLockfile: boolean
    outdatedDependencies: {[pkgId: string]: string}
    projectsDirectPathsByAlias: {
      [id: string]: {[alias: string]: string}
    }
    pruneStore: boolean
    registries: Registries
    rootModulesDir: string
    sideEffectsCacheRead: boolean
    skipped: Set<string>
    storeController: StoreController
    strictPeerDependencies: boolean
    // This is only needed till lockfile v4
    updateLockfileMinorVersion: boolean
    virtualStoreDir: string
    newWantedLockfile: Lockfile
    wantedToBeSkippedPackageIds: Set<string>
  }
): Promise<{
    currentLockfile: Lockfile
    depGraph: DependenciesGraph
    newDepPaths: string[]
    newHoistedDependencies: HoistedDependencies
    removedDepPaths: Set<string>
    wantedLockfile: Lockfile
  }> {
  let depNodes = R.values(depGraph).filter(({ depPath, packageId }) => {
    if (opts.newWantedLockfile.packages?.[depPath] && !opts.newWantedLockfile.packages[depPath].optional) {
      opts.skipped.delete(depPath)
      return true
    }
    if (opts.wantedToBeSkippedPackageIds.has(packageId)) {
      opts.skipped.add(depPath)
      return false
    }
    opts.skipped.delete(depPath)
    return true
  })
  if (!opts.include.dependencies) {
    depNodes = depNodes.filter(({ dev, optional }) => dev || optional)
  }
  if (!opts.include.devDependencies) {
    depNodes = depNodes.filter(({ dev }) => !dev)
  }
  if (!opts.include.optionalDependencies) {
    depNodes = depNodes.filter(({ optional }) => !optional)
  }
  const removedDepPaths = await prune(projects, {
    currentLockfile: opts.currentLockfile,
    dryRun: opts.dryRun,
    hoistedDependencies: opts.hoistedDependencies,
    hoistedModulesDir: (opts.hoistPattern && opts.hoistedModulesDir) ?? undefined,
    include: opts.include,
    lockfileDir: opts.lockfileDir,
    pruneStore: opts.pruneStore,
    publicHoistedModulesDir: (opts.publicHoistPattern && opts.rootModulesDir) ?? undefined,
    registries: opts.registries,
    skipped: opts.skipped,
    storeController: opts.storeController,
    virtualStoreDir: opts.virtualStoreDir,
    wantedLockfile: opts.newWantedLockfile,
  })

  stageLogger.debug({
    prefix: opts.lockfileDir,
    stage: 'importing_started',
  })

  const projectIds = projects.map(({ id }) => id)
  const filterOpts = {
    include: opts.include,
    registries: opts.registries,
    skipped: opts.skipped,
  }
  const newCurrentLockfile = filterLockfileByImporters(opts.newWantedLockfile, projectIds, {
    ...filterOpts,
    failOnMissingDependencies: true,
    skipped: new Set(),
  })
  const newDepPaths = await linkNewPackages(
    filterLockfileByImporters(opts.currentLockfile, projectIds, {
      ...filterOpts,
      failOnMissingDependencies: false,
    }),
    newCurrentLockfile,
    depGraph,
    {
      dryRun: opts.dryRun,
      force: opts.force,
      lockfileDir: opts.lockfileDir,
      optional: opts.include.optionalDependencies,
      sideEffectsCacheRead: opts.sideEffectsCacheRead,
      skipped: opts.skipped,
      storeController: opts.storeController,
      virtualStoreDir: opts.virtualStoreDir,
    }
  )

  stageLogger.debug({
    prefix: opts.lockfileDir,
    stage: 'importing_done',
  })

  const rootDepsByDepPath = depNodes
    .filter(({ depth }) => depth === 0)
    .reduce((acc, depNode) => {
      acc[depNode.depPath] = depNode
      return acc
    }, {})

  await Promise.all(projects.map(({ id, manifest, modulesDir, rootDir }) => {
    const directPathsByAlias = opts.projectsDirectPathsByAlias[id]
    return Promise.all(
      Object.keys(directPathsByAlias)
        .map((rootAlias) => ({ rootAlias, depGraphNode: rootDepsByDepPath[directPathsByAlias[rootAlias]] }))
        .filter(({ depGraphNode }) => depGraphNode)
        .map(async ({ rootAlias, depGraphNode }) => {
          if (
            !opts.dryRun &&
            (await symlinkDependency(depGraphNode.dir, modulesDir, rootAlias)).reused
          ) return

          const isDev = Boolean(manifest.devDependencies?.[depGraphNode.name])
          const isOptional = Boolean(manifest.optionalDependencies?.[depGraphNode.name])
          rootLogger.debug({
            added: {
              dependencyType: isDev && 'dev' || isOptional && 'optional' || 'prod',
              id: depGraphNode.packageId,
              latest: opts.outdatedDependencies[depGraphNode.packageId],
              name: rootAlias,
              realName: depGraphNode.name,
              version: depGraphNode.version,
            },
            prefix: rootDir,
          })
        })
    )
  }))

  let currentLockfile: Lockfile
  const allImportersIncluded = R.equals(projectIds.sort(), Object.keys(opts.newWantedLockfile.importers).sort())
  if (
    opts.makePartialCurrentLockfile ||
    !allImportersIncluded
  ) {
    const packages = opts.currentLockfile.packages ?? {}
    if (opts.newWantedLockfile.packages) {
      for (const depPath in opts.newWantedLockfile.packages) { // eslint-disable-line:forin
        if (depGraph[depPath]) {
          packages[depPath] = opts.newWantedLockfile.packages[depPath]
        }
      }
    }
    const projects = projectIds.reduce((acc, projectId) => {
      acc[projectId] = opts.newWantedLockfile.importers[projectId]
      return acc
    }, opts.currentLockfile.importers)
    currentLockfile = filterLockfileByImporters(
      {
        ...opts.newWantedLockfile,
        importers: projects,
        packages,
      },
      Object.keys(projects), {
        ...filterOpts,
        failOnMissingDependencies: false,
        skipped: new Set(),
      }
    )
  } else if (
    opts.include.dependencies &&
    opts.include.devDependencies &&
    opts.include.optionalDependencies &&
    opts.skipped.size === 0
  ) {
    currentLockfile = opts.newWantedLockfile
  } else {
    currentLockfile = newCurrentLockfile
  }

  let newHoistedDependencies!: HoistedDependencies
  if ((opts.hoistPattern != null || opts.publicHoistPattern != null) && (newDepPaths.length > 0 || removedDepPaths.size > 0)) {
    newHoistedDependencies = await hoist({
      lockfile: currentLockfile,
      lockfileDir: opts.lockfileDir,
      privateHoistedModulesDir: opts.hoistedModulesDir,
      privateHoistPattern: opts.hoistPattern ?? [],
      publicHoistedModulesDir: opts.rootModulesDir,
      publicHoistPattern: opts.publicHoistPattern ?? [],
      virtualStoreDir: opts.virtualStoreDir,
    })
  } else {
    newHoistedDependencies = {}
  }

  if (!opts.dryRun) {
    await Promise.all(
      projects.map((project) =>
        Promise.all(project.linkedDependencies.map((linkedDependency) => {
          const depLocation = resolvePath(project.rootDir, linkedDependency.resolution.directory)
          return symlinkDirectRootDependency(depLocation, project.modulesDir, linkedDependency.alias, {
            fromDependenciesField: linkedDependency.dev && 'devDependencies' || linkedDependency.optional && 'optionalDependencies' || 'dependencies',
            linkedPackage: linkedDependency,
            prefix: project.rootDir,
          })
        }))
      )
    )
  }

  return {
    currentLockfile,
    depGraph,
    newDepPaths,
    newHoistedDependencies,
    removedDepPaths,
    wantedLockfile: opts.newWantedLockfile,
  }
}

const isAbsolutePath = /^[/]|^[A-Za-z]:/

// This function is copied from @pnpm/local-resolver
function resolvePath (where: string, spec: string) {
  if (isAbsolutePath.test(spec)) return spec
  return path.resolve(where, spec)
}

async function linkNewPackages (
  currentLockfile: Lockfile,
  wantedLockfile: Lockfile,
  depGraph: DependenciesGraph,
  opts: {
    dryRun: boolean
    force: boolean
    optional: boolean
    lockfileDir: string
    sideEffectsCacheRead: boolean
    skipped: Set<string>
    storeController: StoreController
    virtualStoreDir: string
  }
): Promise<string[]> {
  const wantedRelDepPaths = R.difference(R.keys(wantedLockfile.packages), Array.from(opts.skipped))

  let newDepPathsSet: Set<string>
  if (opts.force) {
    newDepPathsSet = new Set(
      wantedRelDepPaths
        // when installing a new package, not all the nodes are analyzed
        // just skip the ones that are in the lockfile but were not analyzed
        .filter((depPath) => depGraph[depPath])
    )
  } else {
    newDepPathsSet = await selectNewFromWantedDeps(wantedRelDepPaths, currentLockfile, depGraph)
  }

  statsLogger.debug({
    added: newDepPathsSet.size,
    prefix: opts.lockfileDir,
  })

  const existingWithUpdatedDeps = []
  if (!opts.force && currentLockfile.packages && wantedLockfile.packages) {
    // add subdependencies that have been updated
    // TODO: no need to relink everything. Can be relinked only what was changed
    for (const depPath of wantedRelDepPaths) {
      if (currentLockfile.packages[depPath] &&
        (!R.equals(currentLockfile.packages[depPath].dependencies, wantedLockfile.packages[depPath].dependencies) ||
        !R.equals(currentLockfile.packages[depPath].optionalDependencies, wantedLockfile.packages[depPath].optionalDependencies))) {
        // TODO: come up with a test that triggers the usecase of depGraph[depPath] undefined
        // see related issue: https://github.com/pnpm/pnpm/issues/870
        if (depGraph[depPath] && !newDepPathsSet.has(depPath)) {
          existingWithUpdatedDeps.push(depGraph[depPath])
        }
      }
    }
  }

  if (!newDepPathsSet.size && !existingWithUpdatedDeps.length) return []

  const newDepPaths = Array.from(newDepPathsSet)

  if (opts.dryRun) return newDepPaths

  const newPkgs = R.props<string, DependenciesGraphNode>(newDepPaths, depGraph)

  await Promise.all([
    linkAllModules(newPkgs, depGraph, {
      lockfileDir: opts.lockfileDir,
      optional: opts.optional,
    }),
    linkAllModules(existingWithUpdatedDeps, depGraph, {
      lockfileDir: opts.lockfileDir,
      optional: opts.optional,
    }),
    linkAllPkgs(opts.storeController, newPkgs, {
      force: opts.force,
      targetEngine: opts.sideEffectsCacheRead && ENGINE_NAME || undefined,
    }),
  ])

  return newDepPaths
}

async function selectNewFromWantedDeps (
  wantedRelDepPaths: string[],
  currentLockfile: Lockfile,
  depGraph: DependenciesGraph
) {
  const newDeps = new Set<string>()
  const prevDeps = currentLockfile.packages ?? {}
  await Promise.all(
    wantedRelDepPaths.map(
      async (depPath: string) => {
        const depNode = depGraph[depPath]
        if (!depNode) return
        const prevDep = prevDeps[depPath]
        if (
          prevDep &&
          depNode.resolution['integrity'] === prevDep.resolution['integrity']
        ) {
          if (await fs.exists(depNode.dir)) {
            return
          }
          brokenModulesLogger.debug({
            missing: depNode.dir,
          })
        }
        newDeps.add(depPath)
      }
    )
  )
  return newDeps
}

const limitLinking = pLimit(16)

function linkAllPkgs (
  storeController: StoreController,
  depNodes: DependenciesGraphNode[],
  opts: {
    force: boolean
    targetEngine?: string
  }
) {
  return Promise.all(
    depNodes.map(async (depNode) => {
      const filesResponse = await depNode.fetchingFiles()

      const { isBuilt } = await storeController.importPackage(depNode.dir, {
        filesResponse,
        force: opts.force,
        targetEngine: opts.targetEngine,
      })
      depNode.isBuilt = isBuilt
    })
  )
}

function linkAllModules (
  depNodes: DependenciesGraphNode[],
  depGraph: DependenciesGraph,
  opts: {
    lockfileDir: string
    optional: boolean
  }
) {
  return Promise.all(
    depNodes
      .map(async ({ children, optionalDependencies, name, modules }) => {
        const childrenToLink = opts.optional
          ? children
          : Object.keys(children)
            .reduce((nonOptionalChildren, childAlias) => {
              if (!optionalDependencies.has(childAlias)) {
                nonOptionalChildren[childAlias] = children[childAlias]
              }
              return nonOptionalChildren
            }, {})

        await Promise.all(
          Object.keys(childrenToLink)
            .map(async (childAlias) => {
              if (childrenToLink[childAlias].startsWith('link:')) {
                await limitLinking(() => symlinkDependency(path.resolve(opts.lockfileDir, childrenToLink[childAlias].substr(5)), modules, childAlias))
                return
              }
              const pkg = depGraph[childrenToLink[childAlias]]
              if (!pkg.installable && pkg.optional) return
              if (childAlias === name) {
                logger.warn({
                  message: `Cannot link dependency with name ${childAlias} to ${modules}. Dependency's name should differ from the parent's name.`,
                  prefix: opts.lockfileDir,
                })
                return
              }
              await limitLinking(() => symlinkDependency(pkg.dir, modules, childAlias))
            })
        )
      })
  )
}
