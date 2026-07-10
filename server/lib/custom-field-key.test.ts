import { CUSTOM_FIELD_TYPES, coerceCustomFieldValue, customFieldKey } from './custom-field-key'

describe('customFieldKey', () => {
  test('slugifies a label to lowercase underscore-joined', () => {
    expect(customFieldKey('Roof Age')).toBe('roof_age')
  })

  test('collapses runs of non-alphanumerics and trims the edges', () => {
    expect(customFieldKey('  Year — Built!! ')).toBe('year_built')
  })

  test('keeps digits in the slug', () => {
    expect(customFieldKey('Square Footage 2')).toBe('square_footage_2')
  })

  test('falls back to field when nothing alphanumeric remains', () => {
    expect(customFieldKey('—  —')).toBe('field')
    expect(customFieldKey('')).toBe('field')
  })
})

describe('coerceCustomFieldValue', () => {
  test('trims text and returns null when empty', () => {
    expect(coerceCustomFieldValue('text', '  hi ')).toBe('hi')
    expect(coerceCustomFieldValue('text', '   ')).toBeNull()
    expect(coerceCustomFieldValue('text', null)).toBeNull()
    expect(coerceCustomFieldValue('text', undefined)).toBeNull()
  })

  test('parses numbers and rejects non-numeric input', () => {
    expect(coerceCustomFieldValue('number', '42')).toBe(42)
    expect(coerceCustomFieldValue('number', 7)).toBe(7)
    expect(coerceCustomFieldValue('number', 'abc')).toBeNull()
    expect(coerceCustomFieldValue('number', '')).toBeNull()
  })

  test('checkbox always resolves to a concrete boolean', () => {
    expect(coerceCustomFieldValue('checkbox', true)).toBe(true)
    expect(coerceCustomFieldValue('checkbox', false)).toBe(false)
    expect(coerceCustomFieldValue('checkbox', 'true')).toBe(true)
    expect(coerceCustomFieldValue('checkbox', 'false')).toBe(false)
    expect(coerceCustomFieldValue('checkbox', '')).toBe(false)
  })

  test('dropdown and date behave like trimmed text', () => {
    expect(coerceCustomFieldValue('dropdown', ' Buyer ')).toBe('Buyer')
    expect(coerceCustomFieldValue('date', '2026-06-04')).toBe('2026-06-04')
    expect(coerceCustomFieldValue('date', '  ')).toBeNull()
  })

  test('exposes the known field types', () => {
    expect(CUSTOM_FIELD_TYPES).toContain('dropdown')
    expect(CUSTOM_FIELD_TYPES).toContain('date')
    expect(CUSTOM_FIELD_TYPES).toContain('checkbox')
  })
})
