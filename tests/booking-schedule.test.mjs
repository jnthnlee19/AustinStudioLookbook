import test from 'node:test';
import assert from 'node:assert/strict';
import { availability, assignAppointments, baseSlots } from '../assets/booking-schedule.mjs';

const date = '2026-09-16';
const appointment = (type, time = '10:00', extra = {}) => ({ type, time, date, status: 'requested', ...extra });
const rule = (person, kind = 'off', extra = {}) => ({ person, kind, recurrence: 'once', startDate: date, ...extra });
const remaining = (type, requests = [], rules = [], time = '10:00', day = date) => availability(type, day, requests, rules).find(slot => slot.time === time)?.remaining || 0;

test('Virtual and Final share two places, including pending requests', () => {
  assert.equal(remaining('final'), 2);
  assert.equal(remaining('virtual', [appointment('final')]), 1);
  assert.equal(remaining('final', [appointment('virtual'), appointment('final')]), 0);
});
test('one person off leaves one long appointment in each block', () => {
  for (const time of ['10:00', '15:00']) {
    assert.equal(remaining('final', [], [rule('Jonathan')], time), 1);
    assert.equal(remaining('virtual', [appointment('final', time)], [rule('Jonathan')], time), 0);
  }
});
test('Saturday offers one Final at 9 and 2 with a person off', () => {
  const saturday = '2026-09-19';
  for (const time of ['09:00', '14:00']) assert.equal(remaining('final', [], [rule('Jonathan', 'off', { startDate: saturday })], time, saturday), 1);
  assert.deepEqual(baseSlots('discovery', saturday), []);
  assert.deepEqual(baseSlots('virtual', saturday), []);
});
test('front desk can conduct Discovery while two long appointments run', () => {
  const requests = [appointment('final'), appointment('virtual')];
  assert.equal(remaining('discovery', requests, [], '11:00'), 1);
  requests.push(appointment('discovery', '11:00'));
  assert.equal(remaining('discovery', requests, [], '11:00'), 0);
  assert.equal(remaining('discovery', requests, [], '12:30'), 1);
  assert.equal(remaining('final', [appointment('final'), appointment('discovery', '11:00')]), 1);
});
test('one remaining in-person staff cannot take a long appointment', () => {
  assert.equal(remaining('final', [], [rule('Jonathan'), rule('Missy')]), 0);
  assert.equal(remaining('discovery', [], [rule('Jonathan'), rule('Missy')], '11:00'), 1);
});
test('Virtual Only staff can take Virtual but cannot provide physical desk coverage', () => {
  const rules = [rule('Jonathan'), rule('Missy', 'virtual')];
  assert.equal(remaining('final', [], rules), 0);
  assert.equal(remaining('virtual', [], rules), 1);
  assert.equal(remaining('virtual', [], [rule('', 'virtual')]), 0);
});
test('rules overlapping any part of a long appointment reduce capacity', () => {
  assert.equal(remaining('final', [], [rule('Jonathan', 'meeting', { startTime: '11:00', endTime: '12:00' })]), 1);
  assert.equal(remaining('final', [], [rule('', 'meeting', { startTime: '12:00', endTime: '12:30' })]), 0);
  assert.equal(remaining('final', [], [rule('', 'meeting', { startTime: '12:30', endTime: '13:00' })]), 2);
});
test('assignments, declined requests, and non-overlapping blocks are respected', () => {
  assert.equal(remaining('final', [appointment('final', '10:00', { status: 'declined' })]), 2);
  assert.equal(remaining('final', [appointment('final'), appointment('virtual')], [], '15:00'), 2);
  assert.equal(assignAppointments([appointment('final', '10:00', { assignedTo: 'Jonathan' })], [rule('Jonathan')], date), null);
});
test('recurring rules honor weekday and start/end dates', () => {
  const recurring = { kind: 'off', person: 'Jonathan', recurrence: 'weekly', weekday: 3, startDate: date, endDate: date };
  assert.equal(remaining('final', [], [recurring]), 1);
  assert.equal(remaining('final', [], [recurring], '10:00', '2026-09-23'), 2);
  assert.equal(remaining('final', [], [recurring], '10:00', '2026-09-17'), 2);
});
test('closed and invalid dates offer no slots', () => {
  assert.deepEqual(availability('final', '2026-09-20', [], []), []);
  assert.deepEqual(availability('final', 'bad', [], []), []);
});
