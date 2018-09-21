import test = require('tape')
import {read, write, Modules} from '@pnpm/modules-yaml'
import tempy = require('tempy')

test('write() and read()', async (t) => {
  const modulesYaml = {
    hoistedAliases: {},
    independentLeaves: false,
    layoutVersion: 1,
    packageManager: 'pnpm@2',
    pendingBuilds: [],
    shamefullyFlatten: false,
    skipped: [],
    store: '/.pnpm-store',
  }
  const tempDir = tempy.directory()
  await write(tempDir, tempDir, modulesYaml)
  t.deepEqual(await read(tempDir, tempDir), {...modulesYaml, nodeModulesType: 'dedicated'})
  t.end()
})
