// Passkeys: a resposta montada pelo MySecrets é aceita por um servidor
// WebAuthn independente (@simplewebauthn/server), e o rpId é conferido contra
// a origem pela Public Suffix List.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const sw = require('@simplewebauthn/server');
const pk = require('../src/lib/passkey');

const ORIGIN = 'https://login.exemplo.com.br';
const RP = 'exemplo.com.br';
const challenge = () => crypto.randomBytes(32).toString('base64url');
const user = { id: Buffer.from('usuario-42').toString('base64url'), name: 'eu@exemplo.com.br', displayName: 'Eu' };

// Recusado = o servidor lança erro ou devolve verified: false
async function aceito(fn) {
    try { return (await fn()).verified === true; } catch (_) { return false; }
}

async function registrar(opts = {}) {
    const ch = challenge();
    const { passkey, response } = pk.create({ origin: ORIGIN, rpId: RP, user, challenge: ch, ...opts });
    const v = await sw.verifyRegistrationResponse({
        response, expectedChallenge: ch, expectedOrigin: ORIGIN, expectedRPID: RP, requireUserVerification: true,
    });
    return { passkey, response, v };
}

test('registro é aceito pelo servidor e guarda a chave só no cofre', async () => {
    const { passkey, response, v } = await registrar();
    assert.strictEqual(v.verified, true);
    const info = v.registrationInfo;
    assert.strictEqual(info.fmt, 'none');
    assert.strictEqual(info.credential.id, passkey.credentialId);
    assert.strictEqual(info.credentialDeviceType, 'multiDevice', 'BE: passkey sincronizada');
    assert.strictEqual(info.credentialBackedUp, true, 'BS');
    assert.strictEqual(info.userVerified, true);
    assert.strictEqual(info.aaguid, '00000000-0000-0000-0000-000000000000');
    assert.strictEqual(passkey.rpId, RP);
    assert.strictEqual(passkey.userHandle, user.id);
    assert.ok(!JSON.stringify(response).includes(passkey.privateKey), 'a chave privada não vai para a página');
});

test('login assinado com a passkey guardada é aceito; desafio ou origem trocados não', async () => {
    const { passkey, v } = await registrar();
    const credential = v.registrationInfo.credential;
    const ch = challenge();
    const resp = pk.get({ origin: ORIGIN, rpId: RP, challenge: ch, passkey });
    assert.strictEqual(resp.response.userHandle, user.id);
    const ok = await sw.verifyAuthenticationResponse({
        response: resp, expectedChallenge: ch, expectedOrigin: ORIGIN, expectedRPID: RP, credential, requireUserVerification: true,
    });
    assert.strictEqual(ok.verified, true);

    const base = { expectedOrigin: ORIGIN, expectedRPID: RP, credential };
    assert.strictEqual(await aceito(() => sw.verifyAuthenticationResponse({ ...base, response: resp, expectedChallenge: challenge() })), false, 'outro desafio');
    assert.strictEqual(await aceito(() => sw.verifyAuthenticationResponse({ ...base, response: resp, expectedChallenge: ch, expectedOrigin: 'https://evil.com' })), false, 'outra origem');
    assert.strictEqual(await aceito(() => sw.verifyAuthenticationResponse({ ...base, response: resp, expectedChallenge: ch, expectedRPID: 'evil.com' })), false, 'outro rpId');
    // Assinatura de outra chave
    const outra = (await registrar()).passkey;
    const falsa = pk.get({ origin: ORIGIN, rpId: RP, challenge: ch, passkey: { ...passkey, privateKey: outra.privateKey } });
    assert.strictEqual(await aceito(() => sw.verifyAuthenticationResponse({ ...base, response: falsa, expectedChallenge: ch })), false, 'outra chave');
});

test('sem verificação do usuário o flag UV não é ligado', async () => {
    assert.strictEqual(await aceito(async () => (await registrar({ verified: false })).v), false, 'o servidor que exige UV recusa');
    const { passkey } = pk.create({ origin: ORIGIN, rpId: RP, user, challenge: challenge(), verified: false });
    const resp = pk.get({ origin: ORIGIN, rpId: RP, challenge: challenge(), passkey, verified: false });
    const flags = Buffer.from(resp.response.authenticatorData, 'base64url')[32];
    assert.strictEqual(flags & 0x04, 0);
    assert.strictEqual(flags & 0x01, 1);
});

test('rpId: host, sufixo registrável; nunca outro site, sufixo público, http ou IP', () => {
    assert.strictEqual(pk.checkRpId('https://login.exemplo.com.br', 'exemplo.com.br'), 'exemplo.com.br');
    assert.strictEqual(pk.checkRpId('https://login.exemplo.com.br', undefined), 'login.exemplo.com.br');
    assert.strictEqual(pk.checkRpId('https://a.b.github.com', 'GitHub.com'), 'github.com');
    assert.strictEqual(pk.checkRpId('http://localhost:8080', 'localhost'), 'localhost');
    assert.strictEqual(pk.checkRpId('https://eu.github.io', 'eu.github.io'), 'eu.github.io');
    const recusa = (origin, rp, re) => assert.throws(() => pk.checkRpId(origin, rp), re, `${origin} / ${rp}`);
    recusa('https://login.exemplo.com.br', 'com.br', /sufixo público/);
    recusa('https://eu.github.io', 'github.io', /sufixo público/);
    recusa('https://evil.com', 'github.com', /não pertence/);
    recusa('https://github.com.evil.com', 'github.com', /não pertence/);
    recusa('https://notgithub.com', 'github.com', /não pertence/);
    recusa('https://login.exemplo.com.br', 'outro.exemplo.com.br', /não pertence/);
    recusa('http://github.com', 'github.com', /https/);
    recusa('https://192.168.0.1', '192.168.0.1', /IP/);
    recusa('file:///etc/passwd', 'x', /https/);
    recusa('nada', 'x', /origem inválida/);
});

test('get recusa passkey de outro rpId; matching filtra por site e allowCredentials', () => {
    const { passkey } = pk.create({ origin: ORIGIN, rpId: RP, user, challenge: challenge() });
    assert.throws(() => pk.get({ origin: 'https://github.com', rpId: 'github.com', challenge: challenge(), passkey }), /outro site/);
    const outra = pk.create({ origin: 'https://github.com', rpId: 'github.com', user, challenge: challenge() }).passkey;
    const entries = [
        { id: '1', type: 'passkey', passkey },
        { id: '2', type: 'passkey', passkey: outra },
        { id: '3', type: 'passkey', passkey, deletedAt: '2026-01-01' },
        { id: '4', type: 'login', url: 'https://exemplo.com.br' },
    ];
    assert.deepStrictEqual(pk.matching(entries, RP).map((e) => e.id), ['1']);
    assert.deepStrictEqual(pk.matching(entries, RP, [{ id: passkey.credentialId, type: 'public-key' }]).map((e) => e.id), ['1']);
    assert.deepStrictEqual(pk.matching(entries, RP, [{ id: outra.credentialId, type: 'public-key' }]).map((e) => e.id), []);
});

test('entradas inválidas da página são recusadas', () => {
    const base = { origin: ORIGIN, rpId: RP, user, challenge: challenge() };
    assert.throws(() => pk.create({ ...base, user: { name: 'x' } }), /user.id/);
    assert.throws(() => pk.create({ ...base, user: { id: Buffer.alloc(65).toString('base64url') } }), /64 bytes/);
    assert.throws(() => pk.create({ ...base, challenge: 'não é base64url!' }), /base64url/);
});

test('CBOR: inteiros, bytes, texto e mapas', () => {
    assert.strictEqual(pk.cbor(0).toString('hex'), '00');
    assert.strictEqual(pk.cbor(23).toString('hex'), '17');
    assert.strictEqual(pk.cbor(24).toString('hex'), '1818');
    assert.strictEqual(pk.cbor(1000).toString('hex'), '1903e8');
    assert.strictEqual(pk.cbor(-7).toString('hex'), '26');
    assert.strictEqual(pk.cbor(-1).toString('hex'), '20');
    assert.strictEqual(pk.cbor('fmt').toString('hex'), '63666d74');
    assert.strictEqual(pk.cbor(Buffer.from([1, 2])).toString('hex'), '420102');
    assert.strictEqual(pk.cbor(new Map([[1, 2], [3, -7]])).toString('hex'), 'a201020326');
});
