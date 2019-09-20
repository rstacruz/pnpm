import PnpmError from '@pnpm/error'
import normalize = require('normalize-path')
import os = require('os')
import path = require('path')

// tslint:disable-next-line
const isWindows = process.platform === 'win32' || global['FAKE_WINDOWS']
const isFilespec = isWindows ? /^(?:[.]|~[/]|[/\\]|[a-zA-Z]:)/ : /^(?:[.]|~[/]|[/]|[a-zA-Z]:)/
const isFilename = /[.](?:tgz|tar.gz|tar)$/i
const isAbsolutePath = /^[/]|^[A-Za-z]:/

export interface LocalPackageSpec {
  dependencyPath: string,
  fetchSpec: string,
  id: string,
  type: 'directory' | 'file',
  normalizedPref: string,
}

export default function parsePref (
  pref: string,
  importerPrefix: string,
  lockfileDirectory: string,
): LocalPackageSpec | null {
  if (pref.startsWith('link:')) {
    return fromLocal(pref, importerPrefix, lockfileDirectory, 'directory')
  }
  if (pref.endsWith('.tgz')
    || pref.endsWith('.tar.gz')
    || pref.endsWith('.tar')
    || pref.includes(path.sep)
    || pref.startsWith('file:')
    || isFilespec.test(pref)
  ) {
    const type = isFilename.test(pref) ? 'file' : 'directory'
    return fromLocal(pref, importerPrefix, lockfileDirectory, type)
  }
  if (pref.startsWith('path:')) {
    const err = new PnpmError('PATH_IS_UNSUPPORTED_PROTOCOL', 'Local dependencies via `path:` protocol are not supported. ' +
      'Use the `link:` protocol for folder dependencies and `file:` for local tarballs')
    // tslint:disable:no-string-literal
    err['pref'] = pref
    err['protocol'] = 'path:'
    // tslint:enable:no-string-literal
    throw err
  }
  return null
}

function fromLocal (
  pref: string,
  importerPrefix: string,
  lockfileDirectory: string,
  type: 'file' | 'directory',
): LocalPackageSpec {
  if (!importerPrefix) importerPrefix = process.cwd()

  const spec = pref.replace(/\\/g, '/')
    .replace(/^(file|link):[/]*([A-Za-z]:)/, '$2') // drive name paths on windows
    .replace(/^(file|link):(?:[/]*([~./]))?/, '$2')

  const protocol = type === 'directory' ? 'link:' : 'file:'
  let fetchSpec!: string
  let normalizedPref!: string
  if (/^~[/]/.test(spec)) {
    // this is needed for windows and for file:~/foo/bar
    fetchSpec = resolvePath(os.homedir(), spec.slice(2))
    normalizedPref = `file:${spec}`
  } else {
    fetchSpec = resolvePath(importerPrefix, spec)
    if (isAbsolute(spec)) {
      normalizedPref = `file:${spec}`
    } else {
      normalizedPref = `file:${path.relative(importerPrefix, fetchSpec)}`
    }
  }

  const dependencyPath = normalize(path.relative(importerPrefix, fetchSpec))
  const id = type === 'directory' || importerPrefix === lockfileDirectory
    ? `${protocol}${dependencyPath}`
    : `${protocol}${normalize(path.relative(lockfileDirectory, fetchSpec))}`

  return {
    dependencyPath,
    fetchSpec,
    id,
    normalizedPref,
    type,
  }
}

function resolvePath (where: string, spec: string) {
  if (isAbsolutePath.test(spec)) return spec
  return path.resolve(where, spec)
}

function isAbsolute (dir: string) {
  if (dir[0] === '/') return true
  if (/^[A-Za-z]:/.test(dir)) return true
  return false
}
