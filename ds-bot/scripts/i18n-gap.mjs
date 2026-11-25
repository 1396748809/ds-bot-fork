// Lists every key of the Chinese dictionary that another locale does not have, which is what
// test/i18n.test.js requires: zh is the source of the client's strings.
import { DICTIONARY } from '../src/client/i18n.js'

const locales = ['zh-TW', 'ja', 'ko', 'es', 'fr', 'de']
for (const loc of locales) {
  const lack = Object.keys(DICTIONARY.zh).filter(key => !Object.hasOwn(DICTIONARY[loc] ?? {}, key))
  console.log(`${loc}: ${lack.length}`)
  if (lack.length > 0) console.log(lack.map(key => `  ${JSON.stringify(key)} => ${JSON.stringify(DICTIONARY.zh[key])}`).join('\n'))
}
