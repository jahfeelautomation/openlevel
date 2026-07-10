import { CUSTOM_VALUES_NAMESPACE, customValueKey, customValueToken } from './custom-values'

test('customValueKey slugifies a name into a stable key', () => {
  expect(customValueKey('Business Name')).toBe('business_name')
  expect(customValueKey('Support Phone #')).toBe('support_phone')
  expect(customValueKey('  Booking   Link  ')).toBe('booking_link')
})

test('customValueKey falls back to "value" when nothing alphanumeric remains', () => {
  expect(customValueKey('!!!')).toBe('value')
  expect(customValueKey('')).toBe('value')
})

test('customValueToken builds the namespaced merge tag', () => {
  expect(customValueToken('business_name')).toBe('{{custom_values.business_name}}')
})

test('CUSTOM_VALUES_NAMESPACE is the dotted prefix the renderer matches', () => {
  expect(CUSTOM_VALUES_NAMESPACE).toBe('custom_values')
})
