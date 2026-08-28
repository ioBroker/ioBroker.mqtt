import assert from 'node:assert';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const { ScramExchange, createSalt, saltPassword, SCRAM_SHA_256 } = require('../build/lib/scram');

const hmac = (key: Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();
const xor = (a: Buffer, b: Buffer): Buffer => Buffer.from(a.map((value, i) => value ^ b[i]));

/**
 * A minimal SCRAM-SHA-256 client, written from the RFC instead of reusing the server code, so a
 * mistake in the implementation under test cannot cancel itself out.
 *
 * @param username The user name to authenticate as
 * @param password The password to prove
 * @returns The client's first message, a function producing the final one and the expected signature
 */
function scramClient(
    username: string,
    password: string,
): { first: Buffer; final: (serverFirst: Buffer) => Buffer; serverSignature: () => string } {
    const gs2 = 'n,,';
    const clientNonce = randomBytes(18).toString('base64');
    const clientFirstBare = `n=${username.replace(/=/g, '=3D').replace(/,/g, '=2C')},r=${clientNonce}`;
    let expected = '';

    return {
        first: Buffer.from(gs2 + clientFirstBare, 'utf8'),
        final(serverFirstBuffer: Buffer): Buffer {
            const serverFirst = serverFirstBuffer.toString('utf8');
            const attrs: Record<string, string> = {};
            for (const part of serverFirst.split(',')) {
                attrs[part[0]] = part.substring(2);
            }
            const salted = pbkdf2Sync(
                Buffer.from(password, 'utf8'),
                Buffer.from(attrs.s, 'base64'),
                parseInt(attrs.i, 10),
                32,
                'sha256',
            );
            const clientKey = hmac(salted, 'Client Key');
            const storedKey = sha256(clientKey);
            const withoutProof = `c=${Buffer.from(gs2).toString('base64')},r=${attrs.r}`;
            const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
            const proof = xor(clientKey, hmac(storedKey, authMessage));
            expected = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
            return Buffer.from(`${withoutProof},p=${proof.toString('base64')}`, 'utf8');
        },
        serverSignature: () => expected,
    };
}

describe('SCRAM-SHA-256', function () {
    this.timeout(10000);

    it('exposes the method name the CONNECT packet carries', () => {
        assert.strictEqual(SCRAM_SHA_256, 'SCRAM-SHA-256');
    });

    it('matches the RFC 7677 test vector', async () => {
        // RFC 7677 section 3, user "user" with password "pencil"
        const clientFirstBare = 'n=user,r=rOprNGfwEbeRWgbNEkqO';
        const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
        const serverFirst = `r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`;
        const clientFinal = `c=biws,r=${nonce},p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=`;
        const expected = 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

        const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
        const salted = await saltPassword('pencil', salt, 4096);

        // force the exchange into the state the RFC transcript describes
        const exchange = new ScramExchange('user', salt, 4096);
        exchange.gs2Header = 'n,,';
        exchange.clientFirstBare = clientFirstBare;
        exchange.serverFirst = serverFirst;
        exchange.combinedNonce = nonce;
        exchange.userMatches = true;

        const serverFinal = exchange.finish(Buffer.from(clientFinal, 'utf8'), salted).toString('utf8');
        assert.strictEqual(serverFinal, expected);
    });

    it('completes a full exchange with a correct password', async () => {
        const salt = createSalt();
        const salted = await saltPassword('pass!?#1', salt);
        const client = scramClient('user', 'pass!?#1');

        const exchange = new ScramExchange('user', salt);
        const serverFirst = exchange.begin(client.first);
        const serverFinal = exchange.finish(client.final(serverFirst), salted).toString('utf8');

        assert.strictEqual(serverFinal, `v=${client.serverSignature()}`, 'the server must prove itself as well');
    });

    it('rejects a wrong password', async () => {
        const salt = createSalt();
        const salted = await saltPassword('right', salt);
        const client = scramClient('user', 'wrong');

        const exchange = new ScramExchange('user', salt);
        const serverFirst = exchange.begin(client.first);
        assert.throws(() => exchange.finish(client.final(serverFirst), salted), /invalid proof/);
    });

    it('rejects a wrong user name, and not before the proof is checked', async () => {
        const salt = createSalt();
        const salted = await saltPassword('secret', salt);
        const client = scramClient('somebody', 'secret');

        const exchange = new ScramExchange('user', salt);
        // the server answers normally, so the exchange does not reveal that the user is unknown
        const serverFirst = exchange.begin(client.first);
        assert.ok(serverFirst.length, 'the server must answer a wrong user like any other');
        assert.throws(() => exchange.finish(client.final(serverFirst), salted), /invalid proof/);
    });

    it('rejects a proof from a different exchange', async () => {
        const salt = createSalt();
        const salted = await saltPassword('secret', salt);

        const first = new ScramExchange('user', salt);
        const clientA = scramClient('user', 'secret');
        const finalA = clientA.final(first.begin(clientA.first));

        // a second exchange has its own nonce, so the proof of the first one must not work
        const second = new ScramExchange('user', salt);
        const clientB = scramClient('user', 'secret');
        second.begin(clientB.first);

        assert.throws(() => second.finish(finalA, salted), /nonce mismatch/);
    });

    it('rejects channel binding, which this broker does not offer', () => {
        const exchange = new ScramExchange('user', createSalt());
        assert.throws(
            () => exchange.begin(Buffer.from('p=tls-unique,,n=user,r=abc', 'utf8')),
            /channel binding is not supported/,
        );
    });

    it('rejects malformed messages', () => {
        const exchange = new ScramExchange('user', createSalt());
        assert.throws(() => exchange.begin(Buffer.from('garbage', 'utf8')), /malformed/);

        const fresh = new ScramExchange('user', createSalt());
        assert.throws(
            () => fresh.finish(Buffer.from('c=biws,r=abc', 'utf8'), Buffer.alloc(32)),
            /unexpected client-final-message/,
        );
    });

    it('accepts a user name with an escaped comma and equals sign', async () => {
        const salt = createSalt();
        const salted = await saltPassword('secret', salt);
        const client = scramClient('a,b=c', 'secret');

        const exchange = new ScramExchange('a,b=c', salt);
        const serverFirst = exchange.begin(client.first);
        const serverFinal = exchange.finish(client.final(serverFirst), salted).toString('utf8');

        assert.strictEqual(serverFinal, `v=${client.serverSignature()}`);
    });
});
