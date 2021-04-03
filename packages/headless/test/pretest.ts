import { promises as fs } from 'fs'
import path from 'path'
import rimrafModule from 'rimraf'
import { fileURLToPath } from 'url'

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(DIRNAME, 'fixtures')
const workspaceFixture = path.join(DIRNAME, 'workspace-fixture')
const workspaceFixture2 = path.join(DIRNAME, 'workspace-fixture2')

removeModules()
  .then(() => console.log('Done'))
  .catch(err => console.error(err))

async function removeModules () {
  const dirsToRemove = [
    ...(await fs.readdir(fixtures)).map((dir) => path.join(fixtures, dir)),
    ...(await fs.readdir(workspaceFixture)).map((dir) => path.join(workspaceFixture, dir)),
    ...(await fs.readdir(workspaceFixture2)).map((dir) => path.join(workspaceFixture2, dir)),
    workspaceFixture,
    workspaceFixture2,
  ]
    .map((dir) => path.join(dir, 'node_modules'))
  await Promise.all(dirsToRemove.map(async (dir) => rimraf(dir)))
}

async function rimraf (dir: string) {
  return new Promise<void>((resolve, reject) => rimrafModule(dir, err => err ? reject(err) : resolve()))
}
