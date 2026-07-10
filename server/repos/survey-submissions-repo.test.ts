import { FakeDatabase } from '../db/fake-database'
import { SurveySubmissionsRepo } from './survey-submissions-repo'

test('create inserts with location $1 and json-encodes the raw values', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ss_new', location_id: 'locA', survey_id: 'sv1' }])
  const repo = new SurveySubmissionsRepo(db, 'locA')

  await repo.create({ surveyId: 'sv1', contactId: 'c1', values: { full_name: 'Dana', beds: '3' } })
  const params = db.calls[0]?.params
  expect(db.calls[0]?.sql).toMatch(/INSERT INTO survey_submissions/i)
  expect(params?.[0]).toBe('locA') // location_id is $1
  expect(params).toContain('sv1')
  expect(params).toContain('c1')
  expect(params).toContain(JSON.stringify({ full_name: 'Dana', beds: '3' }))
})

test('create tolerates an anonymous (null contact) submission', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ss_new' }])
  const repo = new SurveySubmissionsRepo(db, 'locA')

  await repo.create({ surveyId: 'sv1', contactId: null, values: {} })
  expect(db.calls[0]?.params).toContain(null)
})

test('listBySurvey scopes to location + survey, newest first', async () => {
  const db = new FakeDatabase()
  db.enqueue([{ id: 'ss1' }])
  const repo = new SurveySubmissionsRepo(db, 'locA')

  await repo.listBySurvey('sv1')
  expect(db.calls[0]?.sql).toMatch(/WHERE location_id = \$1 AND survey_id=\$2/i)
  expect(db.calls[0]?.sql).toMatch(/ORDER BY created_at DESC/i)
  expect(db.calls[0]?.params).toEqual(['locA', 'sv1'])
})
