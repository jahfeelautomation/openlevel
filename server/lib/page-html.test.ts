import { jsonForScript } from './page-html'

// A value embedded inside an inline <script> via plain JSON.stringify can break
// OUT of the script element, because JSON.stringify does not neutralize the
// literal substring "</script>" (nor the HTML-comment opener, nor the JS line
// separators U+2028/U+2029). jsonForScript closes that hole while staying valid
// JSON, so the renderers can embed operator/visitor strings safely.

test('jsonForScript neutralizes a </script> breakout', () => {
  const out = jsonForScript('done</script><script>alert(1)</script>')
  expect(out).not.toContain('</script>')
  expect(out).not.toContain('<script>')
  expect(out).toContain('\\u003c/script\\u003e')
})

test('jsonForScript escapes < > and & to their \\u forms', () => {
  expect(jsonForScript('<')).toBe('"\\u003c"')
  expect(jsonForScript('>')).toBe('"\\u003e"')
  expect(jsonForScript('&')).toBe('"\\u0026"')
})

test('jsonForScript escapes the JS line/paragraph separators', () => {
  expect(jsonForScript(' ')).toBe('"\\u2028"')
  expect(jsonForScript(' ')).toBe('"\\u2029"')
})

test('jsonForScript still produces JSON a browser parses back to the original', () => {
  const original = 'A & B </script> ⟨π⟩'
  // The escaped \uXXXX sequences are valid JSON string escapes, so JSON.parse
  // recovers the exact original value at runtime.
  expect(JSON.parse(jsonForScript(original))).toBe(original)
})

test('jsonForScript serializes non-string values too', () => {
  expect(jsonForScript('')).toBe('""')
  expect(jsonForScript({ a: 1 })).toBe('{"a":1}')
})
