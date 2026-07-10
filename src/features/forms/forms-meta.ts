// Forms reuse the funnel opt-in's label→field mapping: a field labeled "Email"
// becomes { name: 'email', type: 'email' } so the public capture route maps it
// onto the contact's identity. Re-exported here so the forms feature keeps its
// imports local while the mapping stays single-sourced in sites-meta.
export { fieldFromLabel } from '../sites/sites-meta'
