import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MEMORY_ALREADY, MEMORY_SAVED, MEMORY_WRITES, failureRowStays, memoryChanged } from '../src/client/memory-notice.js'

const write = (result, failed = false) => ({ failed, result })

test('a write that changed the memory counts', () => {
  assert.equal(memoryChanged([write('Saved to memory: 一条')]), true)
  assert.equal(memoryChanged([write('Updated in memory: 一条')]), true)
  assert.equal(memoryChanged([write('Removed from memory: 一条')]), true)
})

test('the review lands some entries and refuses another: that still counts as a change', () => {
  assert.equal(memoryChanged([
    write("An entry holds at most 300 characters; this one has 314", true),
    write('Saved to memory: 第一条'),
    write('Saved to memory: 第二条'),
  ]), true, 'the refusal sits under changes that did land, so the step did change the memory')
})

test('nothing landed: no change', () => {
  assert.equal(memoryChanged([write('An entry holds at most 300 characters', true)]), false)
  assert.equal(memoryChanged([]), false)
  assert.equal(memoryChanged(undefined), false)
})

test('an entry that was there already is not a change of its own', () => {
  assert.equal(MEMORY_ALREADY.test('Already in memory: 一条'), true)
  assert.equal(memoryChanged([write('Already in memory: 一条')]), false)
})

test('a failed write does not count even if its text looks like a save', () => {
  assert.equal(MEMORY_SAVED.test('Saved to memory: 一条'), true)
  assert.equal(memoryChanged([write('Saved to memory: 一条', true)]), false)
})

test('the tools that write the memory are the four names the host uses', () => {
  assert.deepEqual([...MEMORY_WRITES], ['bot_remember', 'remember', 'bot_forget', 'forget'])
})

test('an entry refused while others landed gives way, whatever kind of entry it was', () => {
  assert.equal(failureRowStays({ code: 'memory/too-large', landed: true }), false)
  assert.equal(failureRowStays({ code: 'memory/empty', landed: true }), false)
  assert.equal(failureRowStays({ code: undefined, landed: true }), false, 'an unknown failure gives way too')
})

test('a refusal about permission keeps its row even when other entries landed', () => {
  assert.equal(failureRowStays({ code: 'memory/refused', landed: true }), true)
  assert.equal(failureRowStays({ code: 'memory/denied', landed: true }), true)
})

test('nothing landed: the failure is the whole story and stays', () => {
  assert.equal(failureRowStays({ code: 'memory/too-large', landed: false }), true)
  assert.equal(failureRowStays({ code: undefined, landed: false }), true)
  assert.equal(failureRowStays(), true)
})
