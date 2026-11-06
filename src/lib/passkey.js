'use strict';
// Passkeys (WebAuthn) do lado do autenticador: o MySecrets faz o papel da
// "chave de segurança". Gera e guarda a chave ES256, monta o
// authenticatorData / attestationObject e assina. Node puro, sem dependência
// do Electron (o app e o servidor MCP usam). Ver docs/developer/PASSKEYS.md.

const crypto = require('node:crypto');
const { getDomain } = require('tldts');

const ALG_ES256 = -7;
// AAGUID zerado: não identifica o gerenciador (como attestation "none" pede)
const AAGUID = Buffer.alloc(16);

const FLAG_UP = 0x01; // usuário presente
const FLAG_UV = 0x04; // usuário verificado (cofre desbloqueado)
const FLAG_BE = 0x08; // pode ter cópia (sincronizada)
const FLAG_BS = 0x10; // tem cópia (sincronizada pelo cofre)
const FLAG_AT = 0x40; // tem attested credential data

// ===== base64url =====

function b64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function fromB64url(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error('base64url inválido');
    return Buffer.from(s, 'base64url');
}

// ===== CBOR (só o que o WebAuthn usa: inteiros, bytes, texto, mapas) =====

function cborHead(major, n) {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
    if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}

function cbor(v) {
    if (Number.isInteger(v)) return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
    if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
    if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cborHead(3, b.length), b]); }
    if (v instanceof Map) {
        const parts = [cborHead(5, v.size)];
        for (const [k, val] of v) parts.push(cbor(k), cbor(val));
        return Buffer.concat(parts);
    }
    throw new Error('tipo CBOR não suportado');
}

// ===== rpId x origem =====

/**
 * Confere o rpId pedido pela página contra a origem da aba e devolve o rpId
 * efetivo. Regras do WebAuthn: só https (e http://localhost); o rpId é o host
 * ou um sufixo dele que ainda seja um domínio registrável (nunca "com",
 * "github.io" ou outro site).
 */
function checkRpId(origin, rpId) {
    let u;
    try { u = new URL(origin); } catch (e) { throw new Error('origem inválida', { cause: e }); }
    const host = u.hostname.toLowerCase();
    const local = host === 'localhost' || host.endsWith('.localhost');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('passkeys só em https');
    const rp = (rpId == null || rpId === '' ? host : String(rpId)).toLowerCase();
    if (local) {
        const sufixo = host.endsWith('.' + rp) && (rp === 'localhost' || rp.endsWith('.localhost'));
        if (rp !== host && !sufixo) throw new Error('rpId não pertence a esta origem');
        return rp;
    }
    if (/^[\d.]+$/.test(host) || host.includes(':')) throw new Error('passkeys não funcionam em endereço IP');
    if (rp !== host && !host.endsWith('.' + rp)) throw new Error('rpId não pertence a esta origem');
    const site = getDomain(host, { allowPrivateDomains: true });
    if (!site || (rp !== site && !rp.endsWith('.' + site))) throw new Error('rpId é um sufixo público');
    return rp;
}

// ===== Montagem =====

function clientDataJSON({ type, challenge, origin }) {
    // Mesma ordem dos navegadores; montado aqui, nunca vindo da página
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

function coseKey(publicKey) {
    const jwk = publicKey.export({ format: 'jwk' });
    return cbor(new Map([
        [1, 2],               // kty: EC2
        [3, ALG_ES256],       // alg
        [-1, 1],              // crv: P-256
        [-2, fromB64url(jwk.x)],
        [-3, fromB64url(jwk.y)],
    ]));
}

function authenticatorData({ rpId, flags, signCount = 0, credentialId, publicKey }) {
    const head = Buffer.alloc(37);
    crypto.createHash('sha256').update(rpId).digest().copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(signCount >>> 0, 33);
    if (!credentialId) return head;
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credentialId.length);
    return Buffer.concat([head, AAGUID, len, credentialId, coseKey(publicKey)]);
}

function flagsFor(verified) {
    return FLAG_UP | (verified ? FLAG_UV : 0) | FLAG_BE | FLAG_BS;
}

/**
 * Cria uma passkey. Devolve { passkey } (o que vai para o cofre, com a chave
 * privada) e { response } (o que vai para a página, sem a chave privada).
 */
function create({ origin, rpId, rpName, user, challenge, verified = true, createdBy = 'browser' }) {
    const rp = checkRpId(origin, rpId);
    if (!user || !user.id) throw new Error('user.id ausente');
    const userHandle = fromB64url(user.id);
    if (userHandle.length < 1 || userHandle.length > 64) throw new Error('user.id deve ter de 1 a 64 bytes');
    fromB64url(challenge);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const credentialId = crypto.randomBytes(16);
    const authData = authenticatorData({ rpId: rp, flags: flagsFor(verified) | FLAG_AT, credentialId, publicKey });
    const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const cdj = clientDataJSON({ type: 'webauthn.create', challenge, origin: new URL(origin).origin });
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    return {
        passkey: {
            rpId: rp,
            rpName: rpName || rp,
            credentialId: b64url(credentialId),
            userHandle: b64url(userHandle),
            userName: String(user.name || ''),
            userDisplayName: String(user.displayName || ''),
            alg: ALG_ES256,
            privateKey: b64url(privateKey.export({ format: 'der', type: 'pkcs8' })),
            publicKey: b64url(spki),
            signCount: 0,
            discoverable: true,
            createdBy,
        },
        response: {
            id: b64url(credentialId),
            rawId: b64url(credentialId),
            type: 'public-key',
            authenticatorAttachment: 'platform',
            clientExtensionResults: { credProps: { rk: true } },
            response: {
                clientDataJSON: b64url(cdj),
                attestationObject: b64url(attestationObject),
                authenticatorData: b64url(authData),
                publicKey: b64url(spki),
                publicKeyAlgorithm: ALG_ES256,
                transports: ['internal', 'hybrid'],
            },
        },
    };
}

/** Assina um login com uma passkey guardada. */
function get({ origin, rpId, challenge, passkey, verified = true }) {
    const rp = checkRpId(origin, rpId);
    if (!passkey || passkey.rpId !== rp) throw new Error('passkey de outro site');
    fromB64url(challenge);
    const authData = authenticatorData({ rpId: rp, flags: flagsFor(verified), signCount: passkey.signCount || 0 });
    const cdj = clientDataJSON({ type: 'webauthn.get', challenge, origin: new URL(origin).origin });
    const key = crypto.createPrivateKey({ key: fromB64url(passkey.privateKey), format: 'der', type: 'pkcs8' });
    const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(cdj).digest()]), key);
    return {
        id: passkey.credentialId,
        rawId: passkey.credentialId,
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
        response: {
            clientDataJSON: b64url(cdj),
            authenticatorData: b64url(authData),
            signature: b64url(signature),
            userHandle: passkey.userHandle,
        },
    };
}

/**
 * Passkeys do cofre que servem para este pedido: mesmo rpId e, se a página
 * listou credenciais (allowCredentials), só essas.
 */
function matching(entries, rpId, allowCredentials) {
    const allow = Array.isArray(allowCredentials) && allowCredentials.length
        ? new Set(allowCredentials.map((c) => (c && typeof c.id === 'string' ? c.id.replace(/=+$/, '') : '')))
        : null;
    return (entries || []).filter((e) => e && !e.deletedAt && e.type === 'passkey' && e.passkey
        && e.passkey.rpId === rpId && (!allow || allow.has(e.passkey.credentialId)));
}

module.exports = { checkRpId, create, get, matching, cbor, b64url, fromB64url, ALG_ES256 };
