"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScramExchange = exports.ScramError = exports.SCRAM_SHA_256 = void 0;
exports.saltPassword = saltPassword;
exports.createSalt = createSalt;
const node_crypto_1 = require("node:crypto");
/**
 * Server side of SCRAM-SHA-256 (RFC 5802 with the SHA-256 profile of RFC 7677), as used for the
 * MQTT 5 enhanced authentication (MQTT-5.0 4.12).
 *
 * The point of SCRAM is that the password never travels over the wire: both sides prove to each
 * other that they know it. The client proves it with a signature over the whole exchange, the
 * server answers with a signature of its own, so a fake broker cannot collect passwords either.
 */
/** The authentication method name this module implements, as it appears in the CONNECT packet. */
exports.SCRAM_SHA_256 = 'SCRAM-SHA-256';
/**
 * Iteration count for the key derivation. RFC 7677 requires at least 4096; it is the value
 * practically every SCRAM implementation uses and the one clients expect to be cheap enough.
 */
const ITERATIONS = 4096;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 24;
/** Everything that went wrong during an exchange is reported as this, never with details. */
class ScramError extends Error {
}
exports.ScramError = ScramError;
/**
 * Derives the salted password (`Hi(password, salt, i)` in RFC 5802).
 *
 * @param password The plain password from the adapter configuration
 * @param salt The salt announced to the client
 * @param iterations The iteration count announced to the client
 * @returns The salted password
 */
function saltPassword(password, salt, iterations = ITERATIONS) {
    return new Promise((resolve, reject) => {
        (0, node_crypto_1.pbkdf2)(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256', (err, derived) => err ? reject(err) : resolve(derived));
    });
}
function hmac(key, data) {
    return (0, node_crypto_1.createHmac)('sha256', key).update(data).digest();
}
function sha256(data) {
    return (0, node_crypto_1.createHash)('sha256').update(data).digest();
}
function xor(a, b) {
    const result = Buffer.allocUnsafe(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}
/**
 * Compares two buffers without leaking through the runtime how much of them matched.
 *
 * @param a First buffer
 * @param b Second buffer
 * @returns Whether both are equal
 */
function equals(a, b) {
    return a.length === b.length && (0, node_crypto_1.timingSafeEqual)(a, b);
}
/**
 * Splits a SCRAM message ("a=1,b=2,...") into its attributes.
 *
 * @param message The message to split
 * @returns The attributes by their one letter name
 */
function attributes(message) {
    const result = {};
    for (const part of message.split(',')) {
        if (part.length > 1 && part[1] === '=') {
            result[part[0]] = part.substring(2);
        }
    }
    return result;
}
/**
 * Undoes the escaping SCRAM uses inside a user name: "=2C" is a comma, "=3D" an equals sign.
 *
 * @param name The user name as it appears in the message
 * @returns The decoded user name, or null if it contains an invalid escape
 */
function decodeUsername(name) {
    // any other "=" sequence is invalid (RFC 5802, "saslname")
    if (/=(?!2C|3D)/.test(name)) {
        return null;
    }
    return name.replace(/=2C/g, ',').replace(/=3D/g, '=');
}
/**
 * One SCRAM-SHA-256 exchange with a single client.
 *
 * The instance is used exactly once: `begin()` consumes the client's first message and returns the
 * server's answer, `finish()` verifies the client's proof and returns the server's own.
 */
class ScramExchange {
    username;
    /** Whether the name the client sent is the configured one; only acted on in `finish()` */
    userMatches = false;
    salt;
    iterations;
    clientFirstBare = '';
    serverFirst = '';
    combinedNonce = '';
    gs2Header = '';
    /**
     * @param username The user name the adapter is configured with
     * @param salt The salt to announce; stable per adapter instance
     * @param iterations The iteration count to announce
     */
    constructor(username, salt, iterations = ITERATIONS) {
        this.username = username;
        this.salt = salt;
        this.iterations = iterations;
    }
    /**
     * Consumes the client's first message and produces the server's first message.
     *
     * @param clientFirst The authentication data of the CONNECT packet
     * @returns The server's first message, to be sent as authentication data of an AUTH packet
     */
    begin(clientFirst) {
        const message = clientFirst.toString('utf8');
        // gs2-header: "n,," (no channel binding), "y,," (client thinks we cannot do it) or
        // "p=<type>,," (channel binding required, which this broker does not offer)
        const match = /^(([ny]|p=[^,]+),[^,]*,)(.*)$/s.exec(message);
        if (!match) {
            throw new ScramError('malformed client-first-message');
        }
        if (match[2].startsWith('p=')) {
            throw new ScramError('channel binding is not supported');
        }
        this.gs2Header = match[1];
        this.clientFirstBare = match[3];
        const parsed = attributes(this.clientFirstBare);
        const username = parsed.n === undefined ? null : decodeUsername(parsed.n);
        const clientNonce = parsed.r;
        if (username === null || !clientNonce) {
            throw new ScramError('malformed client-first-message');
        }
        // The name is compared here, but a wrong one must fail exactly like a wrong password: the
        // exchange runs to the end either way, so it never reveals which of the two was wrong.
        this.userMatches = username === this.username;
        this.combinedNonce = clientNonce + (0, node_crypto_1.randomBytes)(NONCE_LENGTH).toString('base64');
        this.serverFirst = `r=${this.combinedNonce},s=${this.salt.toString('base64')},i=${this.iterations}`;
        return Buffer.from(this.serverFirst, 'utf8');
    }
    /**
     * Verifies the client's proof and produces the server's final message.
     *
     * @param clientFinal The authentication data of the client's AUTH packet
     * @param saltedPassword The salted password, precomputed by the caller
     * @returns The server's final message, to be sent as authentication data of the CONNACK
     */
    finish(clientFinal, saltedPassword) {
        if (!this.serverFirst) {
            throw new ScramError('unexpected client-final-message');
        }
        const message = clientFinal.toString('utf8');
        const withoutProof = message.replace(/,p=[^,]*$/, '');
        if (withoutProof === message) {
            throw new ScramError('client-final-message has no proof');
        }
        const parsed = attributes(message);
        if (parsed.r !== this.combinedNonce) {
            throw new ScramError('nonce mismatch');
        }
        // the client repeats the gs2-header it used, so a downgrade of the channel binding shows up
        if (parsed.c !== Buffer.from(this.gs2Header, 'utf8').toString('base64')) {
            throw new ScramError('channel binding mismatch');
        }
        const proof = Buffer.from(parsed.p ?? '', 'base64');
        if (proof.length !== 32) {
            throw new ScramError('malformed proof');
        }
        const clientKey = hmac(saltedPassword, 'Client Key');
        const storedKey = sha256(clientKey);
        const authMessage = `${this.clientFirstBare},${this.serverFirst},${withoutProof}`;
        const clientSignature = hmac(storedKey, authMessage);
        // The client sends ClientKey XOR ClientSignature, so the key it used comes back out here
        // and has to hash to the key we derived from the configured password.
        if (!equals(sha256(xor(proof, clientSignature)), storedKey) || !this.userMatches) {
            throw new ScramError('invalid proof');
        }
        const serverKey = hmac(saltedPassword, 'Server Key');
        const serverSignature = hmac(serverKey, authMessage);
        return Buffer.from(`v=${serverSignature.toString('base64')}`, 'utf8');
    }
}
exports.ScramExchange = ScramExchange;
/**
 * Creates the salt a server announces. It stays the same for the lifetime of the adapter instance,
 * so the expensive key derivation only has to run once.
 *
 * @returns A random salt
 */
function createSalt() {
    return (0, node_crypto_1.randomBytes)(SALT_LENGTH);
}
//# sourceMappingURL=scram.js.map