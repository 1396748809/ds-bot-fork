// What a memory write's result says happened, and whether a step's writes changed anything.
//
// The memory review writes several entries in one step: it may answer "Saved to …" three times
// and refuse one entry, or refuse all of them. One refused entry is not worth an error row above
// the changes that did land — except a refusal about permission, which says the whole write was
// not allowed and is its own news, not a footnote to the entries that happened to fit.

export const MEMORY_SAVED = /^(Saved to|Updated in|Removed from) /
export const MEMORY_ALREADY = /^Already in /

// The tools that write the memory (the host's names, and the aliases a Bot may call).
export const MEMORY_WRITES = ['bot_remember', 'remember', 'bot_forget', 'forget']

// A refusal that is about who may write, not about the one entry that was handed in.
export const MEMORY_PERMISSION = ['memory/refused', 'memory/denied']

/**
 * Whether any of a step's memory writes changed the memory.
 * @param {{failed?: boolean, result?: unknown}[]} writes
 * @returns {boolean}
 */
export function memoryChanged(writes) {
  return (Array.isArray(writes) ? writes : []).some(write =>
    write?.failed !== true && MEMORY_SAVED.test(String(write?.result ?? '')))
}

/**
 * Whether a failed write keeps its own error row. It does when nothing else in the step landed
 * (the failure is then the whole story), and when the failure is about permission (the entries
 * that did land do not answer it). A per-entry refusal beside entries that landed gives way.
 * @param {{code?: unknown, landed?: boolean}} input
 * @returns {boolean}
 */
export function failureRowStays({ code, landed } = {}) {
  if (landed !== true) return true
  return MEMORY_PERMISSION.includes(String(code ?? ''))
}
