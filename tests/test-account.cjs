'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('package install creates missing accounts, verifies upgrades and rejects mismatched existing groups', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-account-'));
    const script = path.resolve(__dirname, '../files/pkg-install');
    try {
        const commands = {
            pw: 'case "$1" in\ngroupshow) test -f "$STATE/group";;\ngroupadd) touch "$STATE/group";;\nusershow) test -f "$STATE/user" || exit 1; echo "kaigi:*:123:123::0:0:Kaigi:/nonexistent:/usr/sbin/nologin";;\nuseradd) touch "$STATE/user";;\n*) exit 1;;\nesac\n',
            id: 'case "$1" in -u) echo 123;; -gn) echo "${PRIMARY_GROUP:-kaigi}";; *) exit 1;; esac\n',
            getent: 'test -f "$STATE/group"\n',
        };
        for (const [name, body] of Object.entries(commands)) fs.writeFileSync(path.join(root, name), '#!/bin/sh\n' + body, { mode: 0o755 });
        const env = { ...process.env, PATH: root + ':/usr/bin:/bin', STATE: root };
        const install = (phase, extra = {}) => spawnSync('/bin/sh', [script, 'kaigi', phase], { env: { ...env, ...extra }, encoding: 'utf8' });
        assert.equal(install('PRE-INSTALL').status, 0);
        assert(fs.existsSync(path.join(root, 'user')) && fs.existsSync(path.join(root, 'group')));
        assert.equal(install('POST-INSTALL').status, 0);
        assert.notEqual(install('PRE-INSTALL', { PRIMARY_GROUP: 'www' }).status, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
