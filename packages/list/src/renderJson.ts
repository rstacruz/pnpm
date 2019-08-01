import { PackageNode } from 'dependencies-hierarchy'
import getPkgInfo from './getPkgInfo'

export default async function (
  project: {
    name?: string,
    version?: string,
    path: string,
  },
  tree: PackageNode[],
  opts: {
    alwaysPrintRootPackage: boolean,
    long: boolean,
  },
) {
  return JSON.stringify({
    ...project,
    dependencies: await toJsonResult(tree, { long: opts.long }),
  }, null, 2)
}

export async function toJsonResult (
  entryNodes: PackageNode[],
  opts: {
    long: boolean,
  },
): Promise<{}> {
  const dependencies = {}
  await Promise.all(
    entryNodes.map(async (node) => {
      const subDependencies = await toJsonResult(node.dependencies || [], opts)
      const dep = opts.long ? await getPkgInfo(node.pkg) : node.pkg
      if (Object.keys(subDependencies).length) {
        dep['dependencies'] = subDependencies
      }
      const alias = dep.alias
      delete dep.alias
      dependencies[alias] = dep
    }),
  )
  return dependencies
}
