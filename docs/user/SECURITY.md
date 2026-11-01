# Security Policy

## Overview

MySecrets takes security seriously. This document outlines our security practices, how we handle vulnerabilities, and how you can report security issues.

## Supported Versions

| Version | Supported          | Status |
| ------- | ------------------ | ------ |
| 1.0.x   | :white_check_mark: | Active |
| 0.9.x   | :x:                | Beta - Upgrade recommended |
| < 0.9   | :x:                | No longer supported |

**Recommendation**: Always use the latest stable version.

## Security Features

### Encryption

#### Data at Rest
- **Algorithm**: AES-256-CBC (Advanced Encryption Standard, 256-bit key, Cipher Block Chaining mode)
- **Key Derivation**: PBKDF2-SHA256 with 100,000 iterations
- **Salt**: 128-bit (16 bytes) cryptographically random, unique per vault
- **IV**: 128-bit (16 bytes) cryptographically random, unique per encryption operation
- **Implementation**: Node.js native `crypto` module

**Why these choices?**
- AES-256: Industry standard, approved by NSA for TOP SECRET information
- PBKDF2: Slow key derivation prevents brute-force attacks on master password
- 100,000 iterations: Balances security and performance (OWASP recommendation)
- Unique salt: Prevents rainbow table attacks
- Unique IV: Prevents pattern analysis in encrypted data

#### Key Derivation Process

```javascript
Input: Master Password (string)
Output: 256-bit encryption key

1. Generate random salt (16 bytes)
2. Derive key using PBKDF2:
   - Password: user's master password
   - Salt: random salt
   - Iterations: 100,000
   - Key length: 32 bytes (256 bits)
   - Hash function: SHA-256
3. Use derived key for AES-256-CBC encryption
```

**Time to crack** (theoretical, with 12-character random password):
- With 1 billion guesses/sec: ~200 years per password attempt
- With specialized hardware: Still computationally infeasible

### Application Security

#### Process Isolation
- **Context Isolation**: Renderer process cannot access Node.js APIs
- **No Node Integration**: `nodeIntegration: false` prevents direct Node.js access
- **Preload Script**: Only whitelisted APIs exposed via `contextBridge`
- **IPC Validation**: All inter-process communication validated

#### Network Security
- **No External Requests**: Application never sends data over network
- **Navigation Prevention**: Prevents navigation to external URLs
- **No CDN**: All assets bundled locally (except fonts, configurable)
- **No Analytics**: No telemetry or tracking

#### Memory Security
- **Clipboard Clearing**: Automatically cleared after 30 seconds
- **No Password Logging**: Passwords never written to logs
- **Memory Cleanup**: Sensitive data cleared after use
- **No Swap**: (User responsibility - see [Best Practices](#best-practices))

### Data Storage

#### File System
- **Location**: 
  - Linux: `~/.config/mysecrets/secrets.enc`
  - Windows: `%APPDATA%\mysecrets\secrets.enc`
- **Permissions**: 
  - Linux: 600 (read/write owner only)
  - Windows: User-only access via NTFS permissions
- **Format**: JSON structure, encrypted, Base64-encoded

#### No Cloud Storage
- All data stored locally only
- No automatic cloud sync
- No telemetry or crash reports sent
- Complete offline operation

## Threat Model

### What We Protect Against

✅ **File Access by Unauthorized Users**
- Encrypted storage prevents reading data even with file access
- Strong encryption protects against offline attacks

✅ **Memory Dumps**
- Clipboard auto-clears
- Sensitive data not logged
- Master password never persisted

✅ **Brute Force Attacks**
- PBKDF2 with 100,000 iterations slows down password guessing
- No rate limiting needed (offline attacks already slow)

✅ **Rainbow Tables**
- Unique salt per vault prevents pre-computed attack tables

✅ **Malicious Websites**
- Navigation prevention
- Context isolation
- No external resources

### What We Don't Protect Against

⚠️ **Malware on Your Computer**
- If your computer is compromised, the attacker can:
  - Install keylogger to capture master password
  - Take memory dumps while app is unlocked
  - Modify the application itself
- **Mitigation**: Use antivirus, keep OS updated, don't run suspicious software

⚠️ **Physical Access to Unlocked Computer**
- If someone has access while app is unlocked, they can:
  - View and copy all stored data
  - Export unencrypted backups
- **Mitigation**: Lock app when leaving computer, use auto-lock

⚠️ **Shoulder Surfing**
- Visual observation can capture:
  - Master password as you type
  - Displayed passwords and codes
- **Mitigation**: Be aware of surroundings, use privacy screen

⚠️ **Weak Master Password**
- Dictionary words, common passwords easily guessed
- Short passwords vulnerable to brute force
- **Mitigation**: Use strong, random, long master password

⚠️ **Social Engineering**
- Attackers may trick you into revealing master password
- Phishing for password or backup files
- **Mitigation**: Never share master password, verify requests

⚠️ **Hardware Attacks**
- DMA attacks (Thunderbolt, FireWire)
- Cold boot attacks on RAM
- Hardware keyloggers
- **Mitigation**: Use secure boot, encrypted full disk, physical security

⚠️ **Quantum Computing** (future threat)
- AES-256 is quantum-resistant
- PBKDF2-SHA256 may need upgrade in future
- **Mitigation**: Monitor for quantum-resistant algorithm updates

## Best Practices

### For Users

#### Master Password
1. **Length**: Minimum 12 characters, recommend 16+
2. **Complexity**: Mix of uppercase, lowercase, numbers, symbols
3. **Uniqueness**: Don't reuse from other services
4. **Memorability**: Use passphrase (e.g., "correct-horse-battery-staple")
5. **Storage**: Write on paper, store in safe (not digitally)

**Good Examples**:
- `Tr0ub4dor&3` (but better: longer)
- `correct horse battery staple 9912`
- `My$ecret!Pa$$phr@se2024`

**Bad Examples**:
- `password123` (too common)
- `qwerty` (keyboard pattern)
- `MyName1990` (personal info)

#### Backup
1. **Frequency**: Weekly for active use, monthly otherwise
2. **Location**: Multiple locations (USB drive, encrypted cloud)
3. **Testing**: Verify backup imports correctly
4. **Master Password**: Store separately from backup file
5. **Encryption**: Backup files are already encrypted, but add additional layer if stored in cloud

#### System Security
1. **Full Disk Encryption**: Enable BitLocker (Windows) or LUKS (Linux)
2. **Antivirus**: Keep updated and running
3. **OS Updates**: Install security updates promptly
4. **Firewall**: Keep enabled
5. **Disable Swap** (optional, for maximum security):
   ```bash
   # Linux
   sudo swapoff -a
   
   # Windows
   # Control Panel → System → Advanced → Performance → Advanced → Virtual Memory → No paging file
   ```

#### Application Usage
1. **Lock**: Always lock when leaving computer
2. **Auto-lock**: Enable when available (future feature)
3. **Updates**: Keep MySecrets updated
4. **Verification**: Download only from official sources
5. **Screen Privacy**: Use privacy screen filter in public

### For Developers

#### Code Security
1. **Never log sensitive data**: Passwords, keys, tokens
2. **Input validation**: Sanitize all user inputs
3. **Crypto library**: Use standard libraries, don't roll your own
4. **Dependencies**: Keep dependencies updated
5. **Code review**: Security review for all changes

#### Build Security
1. **Reproducible builds**: Same source = same binary
2. **Dependency pinning**: Lock file versions
3. **Audit dependencies**: `npm audit` before release
4. **Sign releases**: Code signing for installers
5. **Checksum**: Provide SHA-256 for downloads

#### Testing
1. **Unit tests**: Test encryption/decryption
2. **Integration tests**: Test IPC security
3. **Fuzzing**: Test with malformed inputs
4. **Penetration testing**: Professional security audit
5. **Static analysis**: Use linters, SAST tools

## Reporting a Vulnerability

### Please DO

✅ **Report Privately**
- Email: security@yourdomain.com (replace with actual email)
- Encrypt email with PGP key (see below)
- Include "SECURITY" in subject line

✅ **Provide Details**
- Description of vulnerability
- Steps to reproduce
- Proof of concept (if applicable)
- Suggested fix (if known)
- Your contact information

✅ **Allow Response Time**
- We aim to respond within 48 hours
- We aim to fix critical issues within 7 days
- We aim to fix high issues within 30 days

✅ **Coordinate Disclosure**
- Work with us on disclosure timing
- Give us time to fix before public disclosure
- We prefer 90 days for complex issues

### Please DON'T

❌ **Public Disclosure First**
- Don't post vulnerability publicly before we've had a chance to fix
- Don't announce on social media
- Don't discuss in public forums

❌ **Exploit**
- Don't use vulnerability maliciously
- Don't access data that isn't yours
- Don't perform DDoS or destructive tests

❌ **Demand Ransom**
- We don't pay for vulnerability reports
- This is an open-source project

### Response Process

1. **Acknowledgment** (within 48 hours)
   - We'll confirm receipt
   - Assign severity level
   - Provide timeline estimate

2. **Investigation** (1-7 days)
   - Reproduce the issue
   - Assess impact
   - Develop fix

3. **Fix** (based on severity)
   - Critical: 7 days
   - High: 30 days
   - Medium: 60 days
   - Low: 90 days

4. **Release**
   - Security patch released
   - Coordinated disclosure
   - Credit to reporter (if desired)

5. **Disclosure**
   - CVE assigned (if applicable)
   - Security advisory published
   - Users notified to update

## Security Contacts

- **Email**: security@yourdomain.com
- **PGP Key**: [Insert PGP public key fingerprint]
- **Response Time**: 48 hours
- **Languages**: English, Portuguese

## Hall of Fame

We recognize security researchers who responsibly disclose vulnerabilities:

| Date | Reporter | Issue | Severity |
|------|----------|-------|----------|
| - | - | - | - |

*Your name could be here!*

## Security Updates

Subscribe to security advisories:
- GitHub: Watch repository → Custom → Security alerts
- Email: security-announce@yourdomain.com

## Compliance

### Standards
- **OWASP**: Follow OWASP Top 10 guidelines
- **CWE**: Address Common Weakness Enumeration issues
- **NIST**: Align with NIST Cybersecurity Framework

### Certifications
Currently: None (open-source project)

Future: ISO 27001, SOC 2 (if commercial version)

## Audits

### Internal
- Code review: Every pull request
- Dependency audit: Monthly
- Penetration testing: Quarterly

### External
- Professional audit: Planned for v2.0
- Bug bounty program: Under consideration

## Encryption Implementation Details

### Code Example

```javascript
// Encryption
const crypto = require('crypto');

function encrypt(plaintext, password) {
  // Generate random salt (128 bits)
  const salt = crypto.randomBytes(16);
  
  // Derive key using PBKDF2
  const key = crypto.pbkdf2Sync(
    password,      // Master password
    salt,          // Random salt
    100000,        // 100,000 iterations
    32,            // 256-bit key
    'sha256'       // Hash algorithm
  );
  
  // Generate random IV (128 bits)
  const iv = crypto.randomBytes(16);
  
  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  // Encrypt data
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return encrypted data with salt and IV
  return {
    encrypted: encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    algorithm: 'aes-256-cbc',
    keyDerivation: 'pbkdf2-sha256',
    iterations: 100000
  };
}

// Decryption
function decrypt(encryptedData, password) {
  // Parse stored data
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  // Derive same key
  const key = crypto.pbkdf2Sync(
    password,
    salt,
    100000,
    32,
    'sha256'
  );
  
  // Create decipher
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  // Decrypt data
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

### Cryptographic Specifications

| Component | Specification |
|-----------|---------------|
| Cipher | AES-256-CBC |
| Block Size | 128 bits |
| Key Size | 256 bits |
| IV Size | 128 bits |
| Salt Size | 128 bits |
| KDF | PBKDF2-HMAC-SHA256 |
| Iterations | 100,000 |
| Library | Node.js crypto (OpenSSL) |

## Future Improvements

### Planned
- [ ] Argon2id key derivation (more memory-hard than PBKDF2)
- [ ] Hardware security module (HSM) support
- [ ] YubiKey integration
- [ ] Biometric authentication (local only)
- [ ] Secure enclave support (macOS)
- [ ] Memory protection (mlock/VirtualLock)
- [ ] Auto-lock after inactivity
- [ ] Failed attempt lockout

### Under Consideration
- [ ] Post-quantum cryptography
- [ ] Zero-knowledge architecture
- [ ] Multi-party computation for shared secrets
- [ ] Threshold cryptography for key splitting

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NIST Special Publication 800-132](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-132.pdf)
- [RFC 2898 - PKCS #5: Password-Based Cryptography](https://tools.ietf.org/html/rfc2898)
- [RFC 3602 - AES-CBC Cipher Algorithm](https://tools.ietf.org/html/rfc3602)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

## Questions?

For security questions (not vulnerabilities), you can:
- Open a GitHub Discussion (for general security questions)
- Email: security@yourdomain.com
- Read documentation: README.md, DEVELOPER_GUIDE.md

---

**Last Updated**: 2024-12-16
**Version**: 1.0.0

**Note**: Replace security@yourdomain.com with actual contact email.

