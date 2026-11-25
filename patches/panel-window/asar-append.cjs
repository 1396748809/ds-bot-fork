// Replace or extend one file inside an Electron app.asar without moving any other file.
//
// The archive is [8-byte size pickle][4-byte string length][JSON header][file bytes]. File
// bytes are located by an absolute offset carried in the header, so a file that is new or
// larger is simply appended at the end of the archive and its header entry pointed there.
// The header keeps its byte length: the patched entry loses its `integrity` block (Electron
// only validates that when the fuses ask, and content patches into the same archive have been
// running fine), and the resulting JSON is padded back to the exact original length with
// spaces, which JSON.parse ignores. Nothing else in the archive moves.
//
// usage: node asar-append.cjs <entryPath> <snippetFile> [--append|--replace] [--archive <path>] [--dry]
//   --append (default)  put the snippet after what the entry already holds; running it twice
//                       does nothing, because the snippet's own first line is the marker
//   --replace           the entry becomes exactly the snippet file
//   --archive           which app.asar (default: %DSBOT_ASAR%, else D:\DS Bot\resources\app.asar)
//   --dry               report what would change, write nothing
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const argv = process.argv.slice(2)
const flag = (name) => { const at = argv.indexOf(name); return at === -1 ? undefined : argv[at + 1] }
const archiveFlag = flag('--archive')
const positional = argv.filter((value, index) => !value.startsWith('--') && (index === 0 || argv[index - 1] !== '--archive'))
const [entryPath, snippetFile] = positional

if (entryPath === undefined || snippetFile === undefined) {
  console.log('usage: node asar-append.cjs <entryPath> <snippetFile> [--append|--replace] [--archive <path>] [--dry]')
  process.exit(2)
}
const replace = argv.includes('--replace')
const dry = argv.includes('--dry')
const ARCHIVE = archiveFlag ?? process.env.DSBOT_ASAR ?? 'D:\\DS Bot\\resources\\app.asar'
const HEADER_START = 16

const buf = fs.readFileSync(ARCHIVE)
const jsonLen = buf.readUInt32LE(12)
const base = buf.readUInt32LE(4) + 8
const header = JSON.parse(buf.toString('utf8', HEADER_START, HEADER_START + jsonLen))

const parts = entryPath.split('/')
let node = header
for (const part of parts.slice(0, -1)) {
  node = node.files?.[part]
  if (node === undefined) throw new Error(`no such folder in the archive: ${part}`)
}
const name = parts[parts.length - 1]
const entry = node.files?.[name]
if (entry === undefined || entry.files !== undefined) throw new Error(`no such file entry: ${entryPath}`)

const now = buf.subarray(base + Number(entry.offset), base + Number(entry.offset) + Number(entry.size))
const snippet = fs.readFileSync(snippetFile)
// The snippet's own first non-empty line names what it is; that line is the marker that stops a
// second run from patching an already patched file.
const marker = snippet.toString('utf8').split('\n').find((line) => line.trim() !== '')?.trim() ?? ''
if (!replace && marker !== '' && now.toString('utf8').includes(marker)) {
  console.log(`ALREADY patched: ${entryPath} holds ${JSON.stringify(marker.slice(0, 60))}`)
  process.exit(0)
}

const content = replace ? snippet : Buffer.concat([now, Buffer.from('\n', 'utf8'), snippet])
const offset = buf.length
const wasSize = Number(entry.size)

entry.offset = String(offset - base)
entry.size = content.length
delete entry.integrity

const json = JSON.stringify(header)
const grown = Buffer.byteLength(json)
if (grown > jsonLen) throw new Error(`header grew past its room: ${grown} > ${jsonLen}`)
const headerBytes = Buffer.from(json + ' '.repeat(jsonLen - grown), 'utf8')
if (headerBytes.length !== jsonLen) throw new Error(`padding landed on ${headerBytes.length} bytes, not ${jsonLen}`)

console.log(`ENTRY   ${entryPath}`)
console.log(`BEFORE  ${wasSize} bytes`)
console.log(`AFTER   ${content.length} bytes (${replace ? 'replaced' : 'appended'})`)
console.log(`HEADER  json=${grown} room=${jsonLen} slack=${jsonLen - grown}`)
if (dry) {
  console.log('DRY run: nothing written')
  process.exit(0)
}

const backup = `D:\\backup\\app.asar.before-append-${Date.now()}.bak`
fs.mkdirSync(path.dirname(backup), { recursive: true })
fs.copyFileSync(ARCHIVE, backup)
console.log(`BACKUP  ${backup}`)

const fd = fs.openSync(ARCHIVE, 'r+')
try {
  fs.writeSync(fd, headerBytes, 0, headerBytes.length, HEADER_START)
  fs.writeSync(fd, content, 0, content.length, offset)
} finally {
  fs.closeSync(fd)
}

// Read the archive back the way the app will: parse the header, follow the entry, hash it.
const after = fs.readFileSync(ARCHIVE)
const afterHeader = JSON.parse(after.toString('utf8', HEADER_START, HEADER_START + jsonLen))
let back = afterHeader
for (const part of parts.slice(0, -1)) back = back.files[part]
const backEntry = back.files[name]
const from = after.readUInt32LE(4) + 8 + Number(backEntry.offset)
const readBack = after.subarray(from, from + Number(backEntry.size))
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const same = hash(readBack) === hash(content)
console.log(`VERIFY  archive=${after.length} entry=${backEntry.offset}+${backEntry.size} matches=${same}`)
process.exit(same ? 0 : 1)
