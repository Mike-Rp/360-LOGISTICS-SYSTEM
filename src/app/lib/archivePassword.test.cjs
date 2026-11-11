const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.join(__dirname, '../components/admin/AccountsPanel.tsx'), 'utf8');
const dialog = fs.readFileSync(path.join(__dirname, '../components/admin/ConfirmPasswordDialog.tsx'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/20261111000000_archive_truck_requires_password.sql'), 'utf8');

/* The <ConfirmPasswordDialog … > element (through its props) that contains a given title. */
function dialogWith(title) {
  const parts = panel.split('<ConfirmPasswordDialog');
  const found = parts.filter((part) => part.includes(`title="${title}"`));
  assert.equal(found.length, 1, `exactly one dialog titled "${title}"`);
  // up to the dialog's last prop (its message holds a closing </>, so the first '/>' is not the end)
  return found[0].slice(0, found[0].indexOf('errorText=') + 'errorText={accountActionError}'.length);
}

test('archiving a truck asks for the password, like archiving a driver', () => {
  const truck = dialogWith('Move truck to archive?');
  const driver = dialogWith('Move driver to archive?');
  assert.doesNotMatch(truck, /requirePassword=\{false\}/, 'the truck dialog must not switch the password prompt off');
  assert.doesNotMatch(driver, /requirePassword=\{false\}/);
  // and the dialog asks for the password unless told otherwise
  assert.match(dialog, /requirePassword = true/);
});

test('both archive dialogs still explain a blocked archive (delivery in progress)', () => {
  assert.match(dialogWith('Move truck to archive?'), /blockedReason=\{truckBlockedReason\(/);
  assert.match(dialogWith('Move driver to archive?'), /blockedReason=\{driverBlockedReason\(/);
});

test('the database enforces it too: archive_truck refuses without a recent password, after the OPM check', () => {
  assert.match(migration, /create or replace function public\.archive_truck\(p_truck_id text\)/);
  const body = migration.slice(migration.indexOf('create or replace function public.archive_truck'));
  const opm = body.indexOf("if not public.is_opm()");
  const reauth = body.indexOf("if not public.signed_in_recently(300) then raise exception 'reauth_required'");
  const lookup = body.indexOf('select * into t from public.trucks');
  assert.ok(opm >= 0 && reauth > opm && lookup > reauth, 'OPM check, then the password check, then any lookup');
});
