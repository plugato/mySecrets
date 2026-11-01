# Contributing to MySecrets

First off, thank you for considering contributing to MySecrets! It's people like you that make MySecrets such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

### Our Pledge

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, discrimination, or offensive comments
- Personal or political attacks
- Public or private harassment
- Publishing others' private information
- Trolling or insulting/derogatory comments

## Getting Started

### Prerequisites

- **Node.js**: v16.0.0 or higher
- **npm**: v8.0.0 or higher
- **Git**: v2.20.0 or higher
- **Code Editor**: VS Code recommended (with ESLint plugin)

### Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR-USERNAME/mysecrets.git
   cd mysecrets
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/original-repo/mysecrets.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Run in development mode**:
   ```bash
   npm run dev
   ```

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**Good bug report includes:**
- **Clear title**: Describe the issue in one sentence
- **Steps to reproduce**: How can others see the issue?
- **Expected behavior**: What should happen?
- **Actual behavior**: What actually happens?
- **Environment**: OS, Node.js version, app version
- **Screenshots**: If applicable
- **Logs**: Console output or error messages

**Template:**
```markdown
### Description
A clear description of what the bug is.

### Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Enter '...'
4. See error

### Expected Behavior
What you expected to happen.

### Actual Behavior
What actually happened.

### Environment
- OS: [e.g., Ubuntu 22.04]
- Node.js: [e.g., v18.12.0]
- MySecrets: [e.g., v1.0.0]

### Screenshots
If applicable, add screenshots.

### Logs
```
Paste relevant logs here
```
```

### Suggesting Enhancements

Enhancement suggestions are welcome!

**Good enhancement suggestion includes:**
- **Clear title**: Describe the feature
- **Use case**: Why is this feature needed?
- **Proposed solution**: How could this work?
- **Alternatives**: What other solutions have you considered?
- **Mockups**: UI sketches if applicable

**Template:**
```markdown
### Feature Description
A clear description of the feature.

### Use Case
Why do you need this feature? What problem does it solve?

### Proposed Solution
How do you think this should work?

### Alternative Solutions
What other approaches have you considered?

### Additional Context
Any other information, screenshots, or mockups.
```

### Contributing Code

#### What to Work On

**Good first issues:**
- Look for issues labeled `good first issue`
- Documentation improvements
- UI/UX enhancements
- Bug fixes
- Adding tests

**Medium difficulty:**
- New entry types
- Additional export formats
- UI improvements
- Performance optimizations

**Advanced:**
- Encryption enhancements
- New authentication methods
- Architecture changes
- Cross-platform features

#### Before You Start

1. **Check existing issues**: Is someone already working on this?
2. **Open an issue**: Discuss your approach before implementing
3. **Get feedback**: Wait for maintainer response on large changes
4. **Create branch**: Create a feature branch from `main`

## Development Setup

### Project Structure

```
mySecrets/
├── src/
│   ├── main.js              # Main process
│   ├── preload.js           # Preload script
│   └── renderer/            # Renderer process
│       ├── index.html       # HTML structure
│       ├── styles.css       # Styles
│       └── app.js           # Application logic
├── assets/                  # Icons and resources
├── test-*.js               # Test scripts
└── package.json            # Project configuration
```

### Running Development Build

```bash
# Start in development mode
npm run dev

# Run tests
node test-totp.js
node test-methods.js

# Build for production
npm run build
```

### Development Tools

**VS Code Extensions (recommended):**
- ESLint
- Prettier
- EditorConfig
- GitLens

**Chrome DevTools:**
- Automatically opens in dev mode
- Console for debugging
- Network tab (should show no external requests)
- Application tab (view local storage)

## Coding Guidelines

### JavaScript Style

We follow standard JavaScript conventions:

```javascript
// Use const for variables that won't be reassigned
const entries = [];

// Use let for variables that will be reassigned
let currentFilter = 'all';

// Use meaningful variable names
const masterPassword = document.getElementById('master-password').value;

// Use camelCase for variables and functions
function loadUserData() {
  // ...
}

// Use PascalCase for classes
class EntryManager {
  // ...
}

// Use UPPER_CASE for constants
const MAX_PASSWORD_LENGTH = 64;

// Add comments for complex logic
// Calculate remaining time for TOTP (period - current second % period)
const remaining = period - (epoch % period);

// Use template literals for strings
const message = `Entry "${title}" saved successfully`;

// Use arrow functions for callbacks
entries.filter(entry => entry.type === 'login');

// Async/await for asynchronous code
async function saveData() {
  const result = await window.api.saveData(data, password);
  if (result.success) {
    console.log('Data saved');
  }
}
```

### Code Organization

```javascript
// Group related functionality
// ===== Authentication =====
function login() { }
function logout() { }
function setupVault() { }

// ===== Data Management =====
function loadData() { }
function saveData() { }
function deleteEntry() { }

// ===== UI Rendering =====
function renderEntries() { }
function renderEntryDetails() { }
```

### Security Guidelines

**NEVER:**
```javascript
// ❌ Don't log sensitive data
console.log('Password:', password);

// ❌ Don't use eval
eval(userInput);

// ❌ Don't use innerHTML with user data
element.innerHTML = userInput;

// ❌ Don't store passwords in localStorage
localStorage.setItem('password', password);
```

**ALWAYS:**
```javascript
// ✅ Log safely
console.log('Password set:', !!password);

// ✅ Use textContent for user data
element.textContent = userInput;

// ✅ Use data attributes safely
element.dataset.entryId = entryId;

// ✅ Validate inputs
if (!password || password.length < 8) {
  throw new Error('Invalid password');
}

// ✅ Clear sensitive data
password = null;
delete entry.password;
```

### Error Handling

```javascript
// Always handle errors
try {
  const result = await dangerousOperation();
  return result;
} catch (error) {
  console.error('Operation failed:', error.message);
  showErrorMessage('Operation failed. Please try again.');
  return null;
}

// Return structured results
function encrypt(data) {
  try {
    // encryption logic
    return { success: true, encrypted: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons)
- `refactor`: Code restructuring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes
- `build`: Build system changes

### Examples

```bash
# Feature
feat(mfa): add HOTP support

Implements HOTP (counter-based OTP) alongside existing TOTP.
Users can now choose between time-based and counter-based codes.

Closes #123

# Bug fix
fix(encryption): use unique IV for each encryption

Previously reused IV, which is insecure. Now generates random IV
for each encryption operation and stores it with encrypted data.

Security vulnerability fix.

# Documentation
docs(readme): add troubleshooting section

Added common issues and solutions for:
- Installation errors
- MFA code issues
- Build failures

# Refactor
refactor(ui): extract entry rendering to separate function

Improved code organization by moving entry rendering logic
out of main render function.

No functional changes.

# Style
style(app): format code with prettier

Applied prettier formatting to all JavaScript files.
No logic changes.
```

### Rules

- **Subject line**:
  - Use imperative mood ("add" not "added" or "adds")
  - Don't capitalize first letter
  - No period at the end
  - Maximum 50 characters

- **Body** (optional):
  - Explain what and why, not how
  - Wrap at 72 characters
  - Separate from subject with blank line

- **Footer** (optional):
  - Reference issues: `Closes #123` or `Fixes #456`
  - Breaking changes: `BREAKING CHANGE: <description>`

## Pull Request Process

### Before Submitting

1. **Update from upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Test your changes**:
   ```bash
   npm run dev  # Manual testing
   node test-*.js  # Run test scripts
   ```

3. **Check for linting errors**:
   ```bash
   npm run lint  # If configured
   ```

4. **Update documentation**:
   - Update README if adding features
   - Add JSDoc comments to functions
   - Update CHANGELOG.md

5. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

6. **Push to your fork**:
   ```bash
   git push origin feature/my-feature
   ```

### Creating Pull Request

1. **Go to GitHub** and create PR from your fork to upstream

2. **Fill in the template**:
   ```markdown
   ## Description
   Brief description of changes.
   
   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update
   
   ## Testing
   How did you test this?
   
   ## Screenshots
   If applicable.
   
   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-reviewed code
   - [ ] Commented hard-to-understand areas
   - [ ] Updated documentation
   - [ ] No new warnings
   - [ ] Added tests (if applicable)
   - [ ] All tests pass
   - [ ] Dependent changes merged
   ```

3. **Request review** from maintainers

### During Review

- **Respond to feedback** promptly and respectfully
- **Make requested changes** in new commits (don't force-push)
- **Update PR description** if scope changes
- **Mark conversations as resolved** when addressed

### After Approval

- Maintainers will merge your PR
- Your branch will be deleted (on GitHub)
- You can delete your local branch:
  ```bash
  git branch -d feature/my-feature
  ```

## Testing

### Manual Testing

Create a test checklist for your changes:

**Example for MFA feature:**
- [ ] TOTP codes generate correctly
- [ ] TOTP codes update every 30 seconds
- [ ] HOTP codes increment counter
- [ ] MFA entries save and load
- [ ] Backup includes MFA data
- [ ] UI shows codes clearly
- [ ] Codes can be copied
- [ ] Works in light and dark theme

### Automated Testing

**Unit Tests** (future):
```javascript
// test/encryption.test.js
const { encrypt, decrypt } = require('../src/main');

describe('Encryption', () => {
  it('should encrypt and decrypt correctly', () => {
    const plaintext = 'secret data';
    const password = 'test-password';
    const encrypted = encrypt(plaintext, password);
    const decrypted = decrypt(encrypted, password);
    expect(decrypted).toBe(plaintext);
  });
});
```

### Test Scripts

Run existing test scripts:
```bash
# Test TOTP generation
node test-totp.js

# Test encryption methods
node test-methods.js

# Test conversion utilities
node test-conversion.js
```

## Documentation

### Code Documentation

Use JSDoc comments for functions:

```javascript
/**
 * Encrypts data using AES-256-CBC with PBKDF2 key derivation
 * @param {string} plaintext - Data to encrypt
 * @param {string} password - Master password
 * @returns {{encrypted: string, salt: string, iv: string}} Encrypted data with salt and IV
 * @throws {Error} If encryption fails
 */
function encrypt(plaintext, password) {
  // implementation
}
```

### Documentation Files

Update relevant documentation:
- **README.md**: User-facing features
- **DEVELOPER_GUIDE.md**: Technical implementation
- **CHANGELOG.md**: Version history
- **SECURITY.md**: Security implications

### Writing Style

- Use clear, simple language
- Include code examples
- Add screenshots for UI changes
- Write for beginners (explain technical terms)
- Use proper markdown formatting

## Community

### Communication Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas, showcase
- **Pull Requests**: Code contributions

### Getting Help

- Check existing documentation first
- Search closed issues
- Ask in GitHub Discussions
- Be patient and respectful

### Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md (future)
- Credited in release notes
- Mentioned in changelog
- Thanked in commit messages

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

## Questions?

Feel free to ask in:
- GitHub Discussions (for general questions)
- Issue comments (for specific issues)
- Pull request comments (for PR-specific questions)

---

Thank you for contributing to MySecrets! 🎉🔒

**Happy coding!**

