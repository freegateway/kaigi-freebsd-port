'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const template = fs.readFileSync(path.join(__dirname, '../files/kaigi.in'), 'utf8');

test('keeps maintenance tests exportable and omits the instance banner', () => {
    const attributes = path.join(__dirname, '../.gitattributes');
    if (fs.existsSync(attributes)) assert.doesNotMatch(fs.readFileSync(attributes, 'utf8'), /tests.*export-ignore/);
    assert(!template.includes('==> Kaigi instance:'));
});

function platformLock(content, platform = process.platform) {
    return platform === 'linux' ? content.replace('/usr/bin/lockf -k -t 30', '/usr/bin/flock -w 30') : content;
}

test('uses native lockf on FreeBSD and substitutes flock only on Linux', () => {
    const command = '/usr/bin/lockf -k -t 30';
    assert.equal(platformLock(command, 'freebsd'), command);
    assert.equal(platformLock(command, 'linux'), '/usr/bin/flock -w 30');
    assert.equal(platformLock(command, 'darwin'), command);
});

test('main README packing entry matches the installed Markdown filename', () => {
    const makefile = fs.readFileSync(path.join(__dirname, '../Makefile'), 'utf8');
    const plist = fs.readFileSync(path.join(__dirname, '../files/plist-extra'), 'utf8');
    assert.match(makefile, /\.for doc in README\.md HARDENING\.md/);
    assert(plist.split('\n').includes('%%DOCSDIR%%/README.md'));
    assert(!plist.split('\n').includes('%%DOCSDIR%%/README.txt'));
});

test('installs the Fail2ban filter and README under share/kaigi', () => {
    const makefile = fs.readFileSync(path.join(__dirname, '../Makefile'), 'utf8');
    const plist = fs.readFileSync(path.join(__dirname, '../files/plist-extra'), 'utf8');
    const message = fs.readFileSync(path.join(__dirname, '../files/pkg-message.in'), 'utf8');
    assert.match(makefile, /\$\{PREFIX\}\/share\/kaigi\/fail2ban\/README.txt/);
    for (const name of ['kaigi.conf', 'README.txt']) assert(plist.includes('share/kaigi/fail2ban/' + name));
    assert(!plist.includes('%%EXAMPLESDIR%%/fail2ban'));
    assert(message.includes('%%PREFIX%%/share/kaigi/fail2ban/'));
});

test('configuration packaging contains inactive example templates only', () => {
    const makefile = fs.readFileSync(path.join(__dirname, '../Makefile'), 'utf8');
    const plist = fs.readFileSync(path.join(__dirname, '../files/plist-extra'), 'utf8');
    const entries = plist.split('\n').filter((line) => line.includes('etc/kaigi/'));
    assert.ok(entries.length >= 10);
    for (const entry of entries) {
        assert.ok(!entry.startsWith('@sample'), entry);
        if (entry === '@dir etc/kaigi') continue;
        assert.match(entry, /etc\/kaigi\/example\//);
        assert.ok(entry.endsWith('.sample') || entry.endsWith('/README'), entry);
    }
    assert.match(makefile, /_KAIGI_APP_TEMPLATES=[\s\S]*?instance-README/);
    assert.match(makefile, /\$\{WRKDIR\}\/instance-README/);
    for (const line of makefile.split('\n').filter((line) => line.includes('${STAGEDIR}${ETCDIR}/'))) {
        assert.ok(line.includes('${ETCDIR}/example'), line);
    }
});

function fixture(native = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaigi-rc-'));
    const config = path.join(root, 'etc/kaigi');
    const application = path.join(root, 'application');
    fs.mkdirSync(path.join(application, 'app/src'), { recursive: true });
    fs.writeFileSync(path.join(application, 'app/src/InstancePaths.js'), '// fixture capability marker\n');
    // Isolate shell orchestration tests from application parsing. The application
    // suite tests the real preflight separately; the native test uses real rc/daemon.
    fs.writeFileSync(path.join(application, 'app/src/StartupSafety.js'), `
        const fs = require('node:fs'), path = require('node:path');
        const root = ${JSON.stringify(root)}, args = process.argv.slice(2);
        if (args[0] === 'preflight') {
            fs.writeFileSync(path.join(root, 'instance-count'), process.env.KAIGI_INSTANCE_COUNT || 'missing');
            fs.appendFileSync(path.join(root, 'events'), 'preflight-begin\\n');
            if (fs.existsSync(path.join(root, 'delay'))) require('node:child_process').spawnSync('/bin/sleep', ['0.2']);
            for (let i = 6; i < args.length; i += 3) {
                const config = path.join(args[1], args[i]);
                for (const name of ['users','kaigi.conf']) if (!fs.existsSync(path.join(config,name))) process.exit(1);
            }
            if (fs.existsSync(path.join(root, 'preflight-fail'))) process.exit(1);
            fs.appendFileSync(path.join(root, 'events'), 'preflight-end\\n');
        } else if (args[0] === 'save-plan') fs.writeFileSync(args[3], '{}');
        else if (args[0] === 'identity' && fs.existsSync(path.join(root, 'stale-identity'))) process.exit(1);
        else if (args[0] === 'ready' || args[0] === 'wait') {
            if (fs.existsSync(path.join(root, 'readiness-fail'))) process.exit(1);
            if (${native}) {
                const deadline = Date.now() + 10000;
                let ready = false;
                while (Date.now() < deadline) {
                    try {
                        const data = JSON.parse(fs.readFileSync(args[1]));
                        ready = data.pid === Number(fs.readFileSync(args[2])) && data.nonce === args[3];
                        if (ready) break;
                    } catch {}
                    require('node:child_process').spawnSync('/bin/sleep', ['0.05']);
                }
                if (!ready) process.exit(1);
            }
        }
    `);
    fs.writeFileSync(path.join(application, 'app/src/Server.js'), `
        const http = require('node:http');
        const server = http.createServer((q, r) => r.end(process.env.KAIGI_INSTANCE));
        server.listen(0, '127.0.0.1', () => {
            console.log('port=' + server.address().port);
            if (process.env.KAIGI_READY_FILE) require('node:fs').writeFileSync(process.env.KAIGI_READY_FILE,
                JSON.stringify({pid:process.pid,nonce:process.env.KAIGI_STARTUP_NONCE}));
        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `);
    for (const instance of ['default', 'staff', 'public']) {
        const directory = path.join(config, instance);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'kaigi.conf'), '# fixture\n');
        fs.writeFileSync(path.join(directory, 'users'), `${instance}|fixture|Example|["example"]\n`);
    }
    const stub = path.join(root, 'rc.subr');
    fs.writeFileSync(stub, `
        load_rc_config() { . "${root}/rc.conf"; }
        checkyesno() { [ "$kaigi_enable" = YES ]; }
        check_pidfile() { return 1; }
        chown() { return 0; }
        install() {
            for argument do directory="$argument"; done
            mkdir -p "$directory"
        }
        run_rc_command() {
            if [ "$1" = start ] && [ "$kaigi_enable" != YES ]; then return 1; fi
            operation="$1"
            case "$operation" in one*) operation=\${operation#one} ;; force*) operation=\${operation#force} ;; quiet*) operation=\${operation#quiet} ;; fast*) operation=\${operation#fast} ;; esac
            case "$operation" in stop) printf 'stop\\n' >> "${root}/events" ;; esac
            case "$operation" in start|restart) eval "$start_precmd" || return 1 ;; esac
            printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$1" "$name" "$pidfile" "$KAIGI_CONFIG_DIR" "$KAIGI_STATE_DIR" "$kaigi_run_user" "$kaigi_run_group" "$HOST_USERS" "$command_args" >> "${root}/capture"
            case "$operation" in start|restart) kaigi_started || { case "$1" in force*) return 0 ;; *) return 1 ;; esac; } ;; esac
            case "$operation" in stop) eval "$stop_postcmd" || return 1 ;; esac
        }
    `);
    const script = path.join(root, 'kaigi');
    let content = template.replaceAll('%%PREFIX%%', root).replaceAll('%%WWWDIR%%', application)
        .replaceAll('%%LOCALBASE%%/bin/node', process.execPath)
        .replaceAll('%%KAIGI_SOURCE_URL%%', 'https://example.invalid/source')
        .replaceAll('/var/run/kaigi', path.join(root, 'run'))
        .replaceAll('/var/log/kaigi', path.join(root, 'log'))
        .replaceAll('/var/db/kaigi', path.join(root, 'state'));
    if (native) content = content.replace('load_rc_config "$name"', `. "${root}/rc.conf"`);
    else content = content.replace('. /etc/rc.subr', `. "${stub}"`);
    if (!native) content = platformLock(content);
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
    return { root, config, application, run, capture, script, rcconf, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('POSIX shell syntax', () => {
    assert.equal(spawnSync('/bin/sh', ['-n', path.join(__dirname, '../files/kaigi.in')]).status, 0);
});

test('recreates only stopped session contents and rejects a symlinked session', () => {
    const f = fixture();
    const settings = 'kaigi_enable="YES"\nkaigi_instances="staff"\n';
    try {
        const session = path.join(f.root, 'run/staff/session');
        const oldReady = path.join(f.root, 'run/staff/startup.abc123');
        fs.mkdirSync(oldReady, { recursive: true });
        fs.mkdirSync(path.join(session, 'startup.stale'), { recursive: true });
        fs.writeFileSync(path.join(session, 'stale.socket'), 'fixture');
        assert.equal(f.run(settings, ['start']).status, 0);
        assert.deepEqual(fs.readdirSync(session), []);
        assert(!fs.existsSync(oldReady));
        fs.writeFileSync(path.join(session, 'stale.socket'), 'fixture');
        assert.equal(f.run(settings, ['stop', 'staff']).status, 0);
        assert(!fs.existsSync(session));
        assert.equal(f.run(settings, ['start']).status, 0);
        fs.writeFileSync(path.join(f.root, 'run/staff/daemon.pid'), String(process.pid));
        fs.writeFileSync(path.join(session, 'preserve'), 'live');
        assert.equal(f.run(settings, ['start']).status, 1);
        assert(fs.existsSync(path.join(session, 'preserve')));
        fs.unlinkSync(path.join(f.root, 'run/staff/daemon.pid'));
        fs.rmSync(session, { recursive: true });
        fs.symlinkSync(f.config, session);
        assert.equal(f.run(settings, ['start']).status, 1);
        assert(fs.existsSync(path.join(f.config, 'staff/users')));
    } finally { f.cleanup(); }
});

test('early startup failure removes its private readiness directory', () => {
    const f = fixture();
    try {
        fs.mkdirSync(path.join(f.root, 'log/staff'), { recursive: true });
        fs.symlinkSync(path.join(f.root, 'outside.log'), path.join(f.root, 'log/staff/kaigi.log'));
        const result = f.run('kaigi_enable="YES"\nkaigi_instances="staff"\n', ['start']);
        assert.equal(result.status, 1);
        assert.deepEqual(fs.readdirSync(path.join(f.root, 'run/staff/session')), []);
    } finally { f.cleanup(); }
});

test('uniform named paths, dispatch, independent credentials and stable secrets', () => {
    const f = fixture();
    try {
        assert.equal(f.run('kaigi_enable="YES"\nkaigi_instances="staff"\n', ['start']).status, 0);
        let records = fs.readFileSync(f.capture, 'utf8').trim().split('\n');
        assert.match(records[0], /start\|kaigi_staff\|/);
        assert(records[0].includes(`${f.root}/run/staff/kaigi.pid|${f.config}/staff|${f.root}/state/staff|www|www|staff|`));
        const settings = 'kaigi_enable="YES"\nkaigi_instances="staff public"\nkaigi_staff_daemon_user="staffuser"\nkaigi_staff_daemon_group="staffgroup"\n';
        assert.equal(f.run(settings, ['start']).status, 0);
        records = fs.readFileSync(f.capture, 'utf8').trim().split('\n');
        assert(records[1].includes('|staffuser|staffgroup|staff|'));
        assert(records[2].includes('|www|www|public|'));
        const secret = name => fs.readFileSync(path.join(f.config, name, 'jwt-secret'), 'utf8');
        const staffSecret = secret('staff');
        assert.match(staffSecret, /^[a-f0-9]{64}\n$/);
        assert.notEqual(staffSecret, secret('public'));
        assert.equal(f.run(settings, ['start', 'staff']).status, 0);
        assert.equal(secret('staff'), staffSecret);
        assert.equal(fs.statSync(path.join(f.config, 'staff/jwt-secret')).mode & 0o777, 0o600);
        for (const action of ['stop', 'restart', 'status', 'onestart', 'rcvar']) {
            assert.equal(f.run(settings, [action, 'staff']).status, 0);
            assert(fs.readFileSync(f.capture, 'utf8').trim().split('\n').at(-1).startsWith(`${action === 'restart' ? 'start' : action}|kaigi_staff|`));
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
            assert.notEqual(f.run(`kaigi_instances="${names}"\n`, ['start']).status, 0);
            assert(!fs.existsSync(f.capture));
        }
        for (const name of ['staff public', '../staff']) {
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

test('missing configuration fails the entire preflight; status needs no credentials', () => {
    const f = fixture();
    try {
        const settings = 'kaigi_enable="YES"\nkaigi_instances="staff public"\n';
        fs.unlinkSync(path.join(f.config, 'staff/users'));
        assert.equal(f.run(settings, ['start']).status, 1);
        assert(!fs.existsSync(f.capture));
        assert.equal(f.run(settings, ['status', 'staff']).status, 0);
        fs.mkdirSync(path.join(f.root, 'run/staff'), { recursive: true });
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
        fs.symlinkSync(sentinel, path.join(f.config, 'staff/jwt-secret'));
        assert.equal(f.run(settings, ['start']).status, 1);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
        fs.unlinkSync(path.join(f.config, 'staff/jwt-secret'));
        fs.unlinkSync(path.join(f.application, 'app/src/StartupSafety.js'));
        assert.equal(f.run(settings, ['start']).status, 1);
    } finally { f.cleanup(); }
});

test('requires at least one explicit instance and never starts example directories implicitly', () => {
    const f = fixture();
    try {
        fs.mkdirSync(path.join(f.config, 'example'), { recursive: true });
        for (const setting of ['', 'kaigi_instances=""\n', 'kaigi_instances="   "\n']) {
            for (const action of ['start', 'restart', 'onestart', 'forcerestart', 'quietstart']) {
                const result = f.run('kaigi_enable="YES"\n' + setting, [action]);
                assert.equal(result.status, 1, action);
                assert.match(result.stdout, /explicit instance name/);
                assert(!fs.existsSync(f.capture));
            }
        }
        assert.equal(f.run('kaigi_enable="YES"\nkaigi_instances="default"\n', ['start']).status, 0);
        const line = fs.readFileSync(f.capture, 'utf8');
        assert.match(line, /start\|kaigi_default\|/);
        assert(line.includes(`${f.config}/default`));
        assert(line.includes(`${f.root}/run/default/kaigi.pid`));
    } finally { f.cleanup(); }
});

test('failed restart preflight leaves running processes untouched and never dispatches stop', () => {
    const f = fixture();
    try {
        fs.writeFileSync(path.join(f.root, 'preflight-fail'), 'fixture');
        const result = f.run('kaigi_enable="YES"\nkaigi_instances="staff public"\n', ['restart', 'staff']);
        assert.equal(result.status, 1);
        assert(!fs.existsSync(f.capture));
        assert.equal(fs.readFileSync(path.join(f.root, 'events'), 'utf8'), 'preflight-begin\n');
    } finally { f.cleanup(); }
});

test('readiness failure returns nonzero within the configured deadline', () => {
    const f = fixture();
    try {
        fs.writeFileSync(path.join(f.root, 'readiness-fail'), 'fixture');
        const before = Date.now();
        for (const action of ['start', 'restart', 'onestart', 'onerestart', 'forcestart', 'forcerestart', 'quietstart', 'quietrestart', 'faststart', 'fastrestart']) {
            const result = f.run('kaigi_enable="YES"\nkaigi_instances="staff"\nkaigi_start_timeout=1\n', [action]);
            assert.equal(result.status, 1, action);
            assert.match(result.stdout, /did not become ready/);
        }
        assert(Date.now() - before < 5000);
    } finally { f.cleanup(); }
});

test('stop and status accept removed names and survive a malformed configured list', () => {
    const f = fixture();
    try {
        assert.equal(f.run('kaigi_instances="../invalid"\n', ['stop', 'staff']).status, 0);
        assert.equal(f.run('kaigi_instances="../invalid"\n', ['status', 'staff']).status, 0);
        fs.mkdirSync(path.join(f.root, 'run/staff'), { recursive: true });
        fs.writeFileSync(path.join(f.root, 'run/staff/kaigi.pid'), String(process.pid));
        // The fixture does not actually stop processes: preserve a live PID's session.
        assert.equal(f.run('kaigi_instances="../invalid"\n', ['stop']).status, 1);
        assert.match(fs.readFileSync(f.capture, 'utf8'), /stop\|kaigi_staff\|/);
        fs.writeFileSync(path.join(f.root, 'stale-identity'), 'fixture');
        assert.equal(f.run('kaigi_instances="public"\n', ['stop', 'staff']).status, 1);
    } finally { f.cleanup(); }
});

test('concurrent service invocations cannot interleave preflight and restart (flock substitute on Linux)', async () => {
    const f = fixture();
    try {
        fs.writeFileSync(f.rcconf, 'kaigi_enable="YES"\nkaigi_instances="staff"\n');
        fs.writeFileSync(path.join(f.root, 'delay'), 'fixture');
        const invoke = () => new Promise((resolve, reject) => {
            const child = spawn('/bin/sh', [f.script, 'restart', 'staff'], { stdio: 'ignore' });
            child.on('error', reject); child.on('exit', code => resolve(code));
        });
        assert.deepEqual(await Promise.all([invoke(), invoke()]), [0, 0]);
        assert.equal(fs.readFileSync(path.join(f.root, 'events'), 'utf8'),
            'preflight-begin\npreflight-end\nstop\npreflight-begin\npreflight-end\nstop\n');
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


test('automatic worker sizing includes unselected configured instances', () => {
    const f = fixture();
    try {
        const result = f.run('kaigi_enable="YES"\nkaigi_instances="staff public"\n', ['start', 'staff']);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(f.root, 'instance-count'), 'utf8'), '2');
    } finally { f.cleanup(); }
});
