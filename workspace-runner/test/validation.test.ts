import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidPythonCommand, isValidWorkspacePath, MAX_FILE_BYTES } from '../src/validation.js'

test('accepts only relative workspace files with supported extensions', () => {
  assert.equal(isValidWorkspacePath('src/main.py'), true)
  assert.equal(isValidWorkspacePath('README.md'), true)
  assert.equal(isValidWorkspacePath('/tmp/main.py'), false)
  assert.equal(isValidWorkspacePath('../main.py'), false)
  assert.equal(isValidWorkspacePath('main.sh'), false)
})

test('accepts only pytest commands from the declared allowlist', () => {
  const allowed = new Set(['pytest -q', 'python -m pytest tests/test_main.py'])
  assert.equal(isValidPythonCommand('pytest -q', allowed), true)
  assert.equal(isValidPythonCommand('python -m pytest tests/test_main.py', allowed), true)
  assert.equal(isValidPythonCommand('python -c "import os"', allowed), false)
  assert.equal(MAX_FILE_BYTES, 262144)
})
