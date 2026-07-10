import { MERGE_FIELDS, renderTemplate } from './merge-fields'

const derek = { first_name: 'Derek', last_name: 'Sull', name: 'Jordan Doe' }

test('substitutes first_name', () => {
  expect(renderTemplate('Hi {{first_name}}, welcome!', derek)).toBe('Hi Derek, welcome!')
})

test('substitutes several tokens including full name and last_name', () => {
  expect(renderTemplate('{{name}} ({{last_name}})', derek)).toBe('Jordan Doe (Sull)')
})

test('tolerates whitespace and case inside the braces', () => {
  expect(renderTemplate('Hi {{ First_Name }}', derek)).toBe('Hi Derek')
})

test('blanks a missing field and tidies the surrounding spacing', () => {
  // no first_name on the contact -> token resolves to '' and the stray double
  // space it leaves is collapsed, so we never send "Hi  ,".
  expect(renderTemplate('Hi {{first_name}}, there', { first_name: null, last_name: null, name: null })).toBe(
    'Hi, there',
  )
})

test('null contact blanks every token', () => {
  expect(renderTemplate('Hi {{first_name}}!', null)).toBe('Hi!')
})

test('leaves unknown tokens untouched', () => {
  expect(renderTemplate('Code {{promo_code}}', derek)).toBe('Code {{promo_code}}')
})

test('every advertised MERGE_FIELDS token actually resolves (no dead menu items)', () => {
  // Guards against the insert menu offering a token the renderer would leave
  // verbatim: each advertised token must render to a real value for a fully
  // populated contact and must not survive unchanged in the output.
  for (const field of MERGE_FIELDS) {
    const out = renderTemplate(`x ${field.token} y`, derek)
    expect(out).not.toContain(field.token)
  }
})

test('MERGE_FIELDS advertises the three primary contact tokens', () => {
  expect(MERGE_FIELDS.map((f) => f.token)).toEqual(['{{first_name}}', '{{last_name}}', '{{name}}'])
})

test('resolves a custom_values token from the supplied location map', () => {
  expect(
    renderTemplate('Call {{custom_values.business_name}} today', null, {
      business_name: 'Acme Roofing',
    }),
  ).toBe('Call Acme Roofing today')
})

test('leaves an unknown custom_values token verbatim (never invented)', () => {
  expect(renderTemplate('Visit {{custom_values.booking_link}}', null, {})).toBe(
    'Visit {{custom_values.booking_link}}',
  )
})

test('blanks a known-but-empty custom value and tidies the surrounding spacing', () => {
  expect(renderTemplate('From {{custom_values.tagline}} , welcome', null, { tagline: '' })).toBe(
    'From, welcome',
  )
})

test('resolves contact tokens and custom values together in one pass', () => {
  expect(
    renderTemplate('Hi {{first_name}}, this is {{custom_values.business_name}}', derek, {
      business_name: 'Acme',
    }),
  ).toBe('Hi Derek, this is Acme')
})

test('leaves a token in an unknown dotted namespace verbatim', () => {
  expect(renderTemplate('Total {{order.total}}', derek, {})).toBe('Total {{order.total}}')
})

test('a 2-arg call leaves every custom_values token verbatim (back-compat)', () => {
  expect(renderTemplate('Hi {{first_name}} {{custom_values.x}}', derek)).toBe(
    'Hi Derek {{custom_values.x}}',
  )
})

