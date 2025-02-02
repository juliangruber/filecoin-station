#!/usr/bin/env -S node

'use strict'

const SATURN_DIST_TAG = 'v0.0.5'

const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const tar = require('tar-fs')
const gunzip = require('gunzip-maybe')
const { request } = require('undici')
const { pipeline } = require('node:stream/promises')

const githubToken = process.env.GITHUB_TOKEN
const authorization = githubToken ? `Bearer ${githubToken}` : undefined

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})

async function main () {
  console.log('Fetching release metadata for %s', SATURN_DIST_TAG)
  console.log('GitHub client:', authorization ? 'authorized' : 'anonymous')

  const { assets } = await fetchReleaseMetadata()

  const outDir = path.resolve(__dirname, 'saturn')
  await mkdir(outDir, { recursive: true })

  await Promise.all(
    assets
      .map(async ({ name, browser_download_url: url }) => {
        const match = name.match(/^saturn-l2_\d+\.\d+\.\d+_([A-Za-z0-9]+)_([A-Za-z0-9_]+)\.tar\.gz$/)
        const platform = match && getPlatform(match[1])
        if (!match || platform !== process.platform) {
          console.log(' ⨯ skipping %s', name)
          return
        }

        const outName = `l2node-${platform}-${getArch(match[2])}`
        console.log(' ⇣ downloading %s', outName)
        const res = await request(url, {
          headers: { authorization },
          maxRedirections: 5
        })

        if (res.statusCode >= 300) {
          throw new Error(
            `Cannot fetch saturn-l2 binary ${name}: ${res.statusCode}\n${await res.body.text()}`
          )
        }

        const outFile = path.join(outDir, outName)
        await pipeline(res.body, gunzip(), tar.extract(outFile))
        console.log(' ✓ %s', outFile)
      })
  )

  console.log('✨ DONE ✨')
}

/**
 * @returns {Promise<{
 *  assets: {name:string, browser_download_url: string}[];
 * }>}
 */
async function fetchReleaseMetadata () {
  const res = await request(
    `https://api.github.com/repos/filecoin-project/saturn-l2/releases/tags/${SATURN_DIST_TAG}`,
    {
      headers: {
        accept: 'application/vnd.github.v3+json',
        'user-agent': 'undici',
        authorization
      }
    }
  )
  if (res.statusCode >= 300) {
    throw new Error(`Cannot fetch saturn-l2 release ${SATURN_DIST_TAG}: ${res.statusCode}\n${await res.body.text()}`)
  }
  const data = await res.body.json()
  return data
}

/**
 * @param {string} golangOs
 */
function getPlatform (golangOs) {
  switch (golangOs) {
    case 'Windows': return 'win32'
    case 'Linux': return 'linux'
    case 'Darwin': return 'darwin'
  }
  throw new Error(`Unkown OS string: ${golangOs}`)
}

/**
 * @param {string} golangArch
 */
function getArch (golangArch) {
  switch (golangArch) {
    case 'x86_64':
      return 'x64'
    case 'i386':
      return 'ia32'
    case 'arm64':
      return 'arm64'
  }

  throw new Error(`Unkown ARCH string: ${golangArch}`)
}
