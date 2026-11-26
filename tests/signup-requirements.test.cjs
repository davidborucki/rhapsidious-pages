const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../signup-requirements.js');
test('password messages use everyday language', () => {
  assert.equal(rules.requirements('password', '').find(r => r.id === 'password-limit').text, 'Not too long');
  assert.equal(rules.requirements('password', 'x'.repeat(73)).find(r => r.id === 'password-limit').text, 'Use a shorter password');
  for (const value of ['', 'Test!._-123', '😀'.repeat(19)]) {
    for (const rule of rules.requirements('password', value)) assert.doesNotMatch(rule.text, /bytes|UTF-8/i);
  }
});
test('untouched, invalid, valid and cleared-after-edit states', () => {
  assert.equal(rules.state(false, false), 'untouched');
  assert.equal(rules.state(false, true), 'untouched');
  assert.equal(rules.state(true, false), 'invalid');
  assert.equal(rules.state(true, true), 'valid');
  assert.equal(rules.valid('password', ''), false);
});
test('password symbols including ! are allowed; username rules are unchanged', () => {
  for (const value of ['Hello!._-123', '!!!!!!!!']) assert.equal(rules.valid('password', value), true);
  assert.equal(rules.valid('username', 'test._-123'), true);
  assert.equal(rules.valid('username', 'test!123'), false);
});
test('password length, UTF-8 ceiling, whitespace and grapheme boundaries', () => {
  for (const value of ['1234567', '        ', 'x'.repeat(73), '😀'.repeat(19), 'e\u0301'.repeat(7)]) assert.equal(rules.valid('password', value), false);
  for (const value of ['12345678', 'x'.repeat(72), '😀'.repeat(18), 'e\u0301'.repeat(8)]) assert.equal(rules.valid('password', value), true);
});
test('email, age and agreement requirements', () => {
  assert.equal(rules.valid('gender', ''), false);
  assert.equal(rules.valid('gender', 'FEMALE'), true);
  for (const value of ['', 'a@', 'a@@example.com', 'a b@example.com']) assert.equal(rules.valid('email', value), false);
  assert.equal(rules.valid('email', 'person+test@example.com'), true);
  const now = new Date('2026-11-25T12:00:00Z');
  for (const value of ['', '2020-01-01', '2013-11-26', '2013-02-30']) assert.equal(rules.requirements('dob', value, now)[0].meets, false);
  assert.equal(rules.requirements('dob', '2013-11-25', now)[0].meets, true);
  assert.equal(rules.valid('agreement', false), false);
  assert.equal(rules.valid('agreement', true), true);
});
