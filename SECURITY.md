# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1.0 | ❌        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

### How to Report

**Do not** open a public issue for security vulnerabilities.

Instead, please send an email to:

- **Email**: security@primasdevlabs.com
- **PGP Key**: Available on request

### What to Include

Please include the following information in your report:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any proof-of-concept or exploit code (if available)
- Suggested mitigation (if known)

### Response Timeline

- **Initial response**: Within 48 hours
- **Detailed assessment**: Within 7 days
- **Resolution timeline**: Depends on severity

### Security Updates

Once a vulnerability is verified:

1. We will develop a fix
2. Coordinate release with affected parties
3. Publish security advisory
4. Update documentation as needed

## Security Best Practices

### For Users

- Keep dependencies updated
- Review code before using in production
- Use environment variables for sensitive data
- Enable security headers in production
- Regular security audits

### For Contributors

- Never commit secrets or credentials
- Validate all external inputs
- Use parameterized queries
- Follow OWASP guidelines
- Security review for sensitive changes

## Dependency Security

We use automated dependency scanning:

- **Dependabot**: Automated dependency updates
- **GitHub Actions**: Security scanning on PRs
- **npm audit**: Regular vulnerability scans

### Reporting Dependency Issues

If you find a vulnerability in our dependencies:

1. Check if it's already reported upstream
2. Report to the dependency maintainer
3. Open an issue with us to coordinate updates

## Security Features

FramerX includes several security features:

- Input validation at compilation boundaries
- No arbitrary code execution in compiled output
- Asset sanitization
- Type safety through TypeScript
- No secrets in generated code

## Disclosure Policy

We follow responsible disclosure:

- Private disclosure to maintainers
- Time for remediation before public disclosure
- Coordinated release with credit to reporter
- Security advisories via GitHub

## Acknowledgments

We thank all security researchers who help keep FramerX safe.

## Contact

For security-related questions not involving vulnerabilities:

- Open a GitHub issue with the `security` label
- Email: security@primasdevlabs.com
