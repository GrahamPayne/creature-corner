import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, normalize } from '../../../src/features/field-guide/commands/parser.js';

test('normalize collapses whitespace and uppercases', () => {
  assert.equal(normalize('  open   test-cr-001  '), 'OPEN TEST-CR-001');
});

test('commands are case-insensitive', () => {
  assert.equal(parse('help').type, 'HELP');
  assert.equal(parse('HeLp').type, 'HELP');
  assert.equal(parse('  STATUS ').type, 'STATUS');
});

test('category commands and aliases', () => {
  for (const raw of ['CREATURES', 'list creatures', 'SHOW CREATURES', 'creature index', 'creatures index']) {
    const a = parse(raw);
    assert.equal(a.type, 'CATEGORY', raw);
    assert.equal(a.category, 'creatures', raw);
  }
  for (const raw of ['artifacts', 'LIST ARTIFACTS', 'show artifacts', 'ARTIFACT INDEX']) {
    assert.equal(parse(raw).category, 'artifacts', raw);
  }
  for (const raw of ['memories', 'list memories', 'SHOW MEMORIES', 'memory index']) {
    assert.equal(parse(raw).category, 'memories', raw);
  }
});

test('OPEN extracts the record id', () => {
  const a = parse('open test-cr-001');
  assert.equal(a.type, 'OPEN');
  assert.equal(a.id, 'TEST-CR-001');
});

test('OPEN without an id still returns OPEN (dispatcher prompts for id)', () => {
  const a = parse('OPEN');
  assert.equal(a.type, 'OPEN');
  assert.equal(a.id, '');
});

test('navigation commands and aliases', () => {
  assert.equal(parse('NEXT').type, 'NEXT');
  assert.equal(parse('previous').type, 'PREV');
  assert.equal(parse('prev').type, 'PREV');
  assert.equal(parse('back').type, 'BACK');
  assert.equal(parse('go back').type, 'BACK');
  assert.equal(parse('RETURN').type, 'BACK');
  assert.equal(parse('home').type, 'HOME');
  assert.equal(parse('main menu').type, 'HOME');
});

test('power off requires the two-word phrase', () => {
  assert.equal(parse('power off').type, 'POWER_OFF');
  assert.equal(parse('POWER   OFF').type, 'POWER_OFF');
  assert.equal(parse('power').type, 'UNKNOWN');
});

test('chat phrases map to restrained responses', () => {
  assert.equal(parse('hello').type, 'CHAT');
  assert.equal(parse('WHO ARE YOU?').key, 'WHO_ARE_YOU');
  assert.equal(parse('are you alive').key, 'ARE_YOU_ALIVE');
  assert.equal(parse('what is this?').key, 'WHAT_IS_THIS');
  assert.equal(parse('what can you do').key, 'WHAT_CAN_YOU_DO');
});

test('unknown input is UNKNOWN, empty input is NOOP', () => {
  assert.equal(parse('summon the beast').type, 'UNKNOWN');
  assert.equal(parse('   ').type, 'NOOP');
});
