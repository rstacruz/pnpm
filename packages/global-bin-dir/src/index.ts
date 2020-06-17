import { sync as canWriteToDir } from 'can-write-to-dir'
import path = require('path')
import PATH = require('path-name')

export default function () {
  const dirs = process.env[PATH]?.split(path.delimiter) ?? []
  const nodeBinDir = path.dirname(process.execPath)
  const secondaryDirs = [] as string[]
  for (const dir of dirs) {
    if (
      isUnderDir('node', dir) ||
      isUnderDir('nodejs', dir) ||
      isUnderDir('npm', dir) ||
      nodeBinDir === dir
    ) {
      if (canWriteToDirAndExists(dir)) return dir
    } else {
      secondaryDirs.push(dir)
    }
  }
  for (const dir of secondaryDirs) {
    if (canWriteToDirAndExists(dir)) return dir
  }
  return undefined
}

function isUnderDir (dir: string, target: string) {
  target = target.endsWith(path.sep) ? target : `${target}${path.sep}`
  return target.includes(`${path.sep}${dir}${path.sep}`) ||
    target.includes(`${path.sep}.${dir}${path.sep}`)
}

function canWriteToDirAndExists (dir: string) {
  try {
    return canWriteToDir(dir)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return false
  }
}
