'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const template = fs.readFileSync(path.join(__dirname, '../files/kaigi.in'), 'utf8');

function fixture(native = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-rc-'));
    const config = path.join(root, 'etc/kaigi');
    const application = path.join(root, 'application');
    fs.mkdirSync(path.join(application, 'app/src'), { recursive: true });
    fs.writeFileSync(path.join(application, 'app/src/InstancePaths.js'), '// fixture capability marker\n');
    fs.writeFileSync(path.join(application, 'app/src/Server.js'), `
        const http = require('node:http');
        const server = http.createServer((q, r) => r.end(process.env.KAIGI_INSTANCE));
        server.listen(0, '127.0.0.1', () => console.log('port=' + server.address().port));
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `);
    for (const instance of ['default', 'staff', 'public']) {
        const directory = instance === 'default' ? config : path.join(config, 'instances', instance);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'kaigi.conf'), '# fixture\n');
        fs.writeFileSync(path.join(directory, 'users'), `${instance}|fixture|Example|["example"]\n`);
    }
    const stub = path.join(root, 'rc.subr');
    fs.writeFileSync(stub, `
        load_rc_config() { . "$TEST_RC_CONF"; }
        install() {
            for argument do directory="$argument"; done
            mkdir -p "$directory"
        }
        run_rc_command() {
            if [ "$1" = start ] && [ "$kaigi_enable" != YES ]; then return 1; fi
            case "$1" in start|onestart) kaigi_precmd || return 1 ;; esac
            printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$1" "$name" "$pidfile" "$KAIGI_CONFIG_DIR" "$KAIGI_STATE_DIR" "$kaigi_run_user" "$kaigi_run_group" "$HOST_USERS" "$command_args" >> "$TEST_CAPTURE"
        }
    `);
    const script = path.join(root, 'kaigi');
    let content = template.replaceAll('%%PREFIX%%', root).replaceAll('%%WWWDIR%%', application)
        .replaceAll('%%LOCALBASE%%/bin/node', process.execPath)
        .replaceAll('%%KAIGI_SOURCE_URL%%', 'https://example.invalid/source')
        .replaceAll('/var/run/kaigi', path.join(root, 'run'))
        .replaceAll('/var/log/kaigi', path.join(root, 'log'))
        .replaceAll('/var/db/kaigi', path.join(root, 'state'));
    if (native) content = content.replace('load_rc_config "$name"', '. "$TEST_RC_CONF"');
    else content = content.replace('. /etc/rc.subr', `. "${stub}"`);
    fs.writeFileSync(script, content);
    const capture = path.join(root, 'capture');
    const rcconf = path.join(root, 'rc.conf');
    function run(settings, args) {
        fs.writeFileSync(rcconf, settings);
        return spawnSync('/bin/sh', [script, ...args], {
            encoding: 'utf8', timeout: 15000,
            env: { PATH: process.env.PATH, TEST_RC_CONF: rcconf, TEST_CAPTURE: capture },
        });
    }
    return { root, config, application, run, capture, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('POSIX shell syntax', () => {
    assert.equal(spawnSync('/bin/sh', ['-n', path.join(__dirname, '../files/kaigi.in')]).status, 0);
});

test('default paths, dispatch, independent credentials and stable secrets', () => {
    const f = fixture();
    try {
        assert.equal(f.run('kaigi_enable="YES"\n', ['start']).status, 0);
        let records = fs.readFileSync(f.capture, 'utf8').trim().split('\n');
        assert.match(records[0], /start\|kaigi\|/);
        assert(records[0].includes(`${f.root}/run/kaigi.pid|${f.config}||www|www|default|`));
        const settings = 'kaigi_enable="YES"\nkaigi_instances="staff public"\nkaigi_staff_daemon_user="staffuser"\nkaigi_staff_daemon_group="staffgroup"\n';
        assert.equal(f.run(settings, ['start']).status, 0);
        records = fs.readFileSync(f.capture, 'utf8').trim().split('\n');
        assert(records[1].includes('|staffuser|staffgroup|staff|'));
        assert(records[2].includes('|www|www|public|'));
        const secret = name => fs.readFileSync(path.join(f.config, 'instances', name, 'jwt-secret'), 'utf8');
        const staffSecret = secret('staff');
        assert.match(staffSecret, /^[a-f0-9]{64}\n$/);
        assert.notEqual(staffSecret, secret('public'));
        assert.equal(f.run(settings, ['start', 'staff']).status, 0);
        assert.equal(secret('staff'), staffSecret);
        assert.equal(fs.statSync(path.join(f.config, 'instances/staff/jwt-secret')).mode & 0o777, 0o600);
        for (const action of ['stop', 'restart', 'status', 'onestart', 'rcvar']) {
            assert.equal(f.run(settings, [action, 'staff']).status, 0);
            assert(fs.readFileSync(f.capture, 'utf8').trim().split('\n').at(-1).startsWith(`${action}|kaigi_staff|`));
        }
        const rotation = fs.readFileSync(path.join(f.root, 'run/newsyslog/staff.conf'), 'utf8');
        assert(rotation.includes(`${f.root}/log/staff/kaigi.log`));
        assert(rotation.includes(`${f.root}/run/staff/daemon.pid`));
        assert(records[1].includes('-H -p '));
        assert(records[1].includes(`-P ${f.root}/run/staff/daemon.pid`));
    } finally { f.cleanup(); }
});

test('rejects invalid, duplicate, unknown and compound selectors before dispatch', () => {
    const f = fixture();
    try {
        for (const names of ['staff ../public', 'staff staff', 'Staff', '*', 'a'.repeat(33)]) {
            assert.notEqual(f.run(`kaigi_instances="${names}"\n`, ['status']).status, 0);
            assert(!fs.existsSync(f.capture));
        }
        for (const name of ['unknown', 'staff public', '../staff']) {
            assert.notEqual(f.run('kaigi_instances="staff public"\n', ['status', name]).status, 0);
            assert(!fs.existsSync(f.capture));
        }
    } finally { f.cleanup(); }
});

test('disabled services do not start normally; onestart explicitly bypasses enable', () => {
    const f = fixture();
    try {
        const settings = 'kaigi_enable="NO"\nkaigi_instances="staff"\n';
        assert.equal(f.run(settings, ['start']).status, 1);
        assert(!fs.existsSync(f.capture));
        assert.equal(f.run(settings, ['onestart']).status, 0);
    } finally { f.cleanup(); }
});

test('missing configuration fails that instance but continues others; status needs no credentials', () => {
    const f = fixture();
    try {
        const settings = 'kaigi_enable="YES"\nkaigi_instances="staff public"\n';
        fs.unlinkSync(path.join(f.config, 'instances/staff/users'));
        assert.equal(f.run(settings, ['start']).status, 1);
        assert.match(fs.readFileSync(f.capture, 'utf8'), /^start\|kaigi_public\|/);
        assert.equal(f.run(settings, ['status', 'staff']).status, 0);
        fs.symlinkSync(path.join(f.root, 'capture'), path.join(f.root, 'run/staff/kaigi.pid'));
        assert.equal(f.run(settings, ['stop', 'staff']).status, 1);
    } finally { f.cleanup(); }
});

test('does not overwrite a symlinked secret or start named instances on an old application', () => {
    const f = fixture();
    try {
        const settings = 'kaigi_enable="YES"\nkaigi_instances="staff"\n';
        const sentinel = path.join(f.root, 'sentinel');
        fs.writeFileSync(sentinel, 'unchanged');
        fs.symlinkSync(sentinel, path.join(f.config, 'instances/staff/jwt-secret'));
        assert.equal(f.run(settings, ['start']).status, 1);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
        fs.unlinkSync(path.join(f.config, 'instances/staff/jwt-secret'));
        fs.unlinkSync(path.join(f.application, 'app/src/InstancePaths.js'));
        assert.equal(f.run(settings, ['start']).status, 1);
    } finally { f.cleanup(); }
});

test('native rc.subr and daemon: stopping/restarting one instance preserves the other; rotation reopens its log', {
    skip: process.platform !== 'freebsd' || process.getuid() !== 0,
}, async () => {
    const f = fixture(true);
    const settings = 'kaigi_enable="YES"\nkaigi_instances="staff public"\nkaigi_daemon_user="root"\nkaigi_daemon_group="wheel"\n';
    const pid = name => Number(fs.readFileSync(path.join(f.root, 'run', name, 'kaigi.pid'), 'utf8').trim());
    async function waitFor(check) {
        for (let count = 0; count < 100; count++) {
            try { if (check()) return; } catch {}
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.fail('Timed out waiting for daemon');
    }
    try {
        assert.equal(f.run(settings, ['start']).status, 0);
        await waitFor(() => pid('staff') > 0 && pid('public') > 0);
        const publicPid = pid('public');
        assert.equal(f.run(settings, ['status', 'staff']).status, 0);
        assert.equal(f.run(settings, ['restart', 'staff']).status, 0);
        assert.equal(pid('public'), publicPid);
        process.kill(publicPid, 0);
        const log = path.join(f.root, 'log/public/kaigi.log');
        await waitFor(() => fs.readFileSync(log, 'utf8').includes('port='));
        fs.renameSync(log, `${log}.old`);
        const supervisor = Number(fs.readFileSync(path.join(f.root, 'run/public/daemon.pid'), 'utf8').trim());
        process.kill(supervisor, 'SIGHUP');
        await waitFor(() => fs.existsSync(log));
        process.kill(publicPid, 0);
        assert.equal(f.run(settings, ['stop', 'staff']).status, 0);
        assert.equal(f.run(settings, ['status', 'public']).status, 0);
    } finally {
        f.run(settings, ['stop']);
        f.cleanup();
    }
});
