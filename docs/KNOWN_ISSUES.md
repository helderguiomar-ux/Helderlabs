# Known Issues - HELDERLABS ERP (RC1)

This log documents residual boundaries or configurations in the Release Candidate (RC1) build.

---

### 1. Mock OAuth Providers Redirection
- **Description**: Google, Microsoft, and Apple ID logins redirect to stylized simulated provider authentication panels (`pages/oauth-mock.html`) instead of real provider endpoints.
- **Reason**: Live OAuth endpoints require registering domain credentials (`Client ID`/`Client Secret`) under a Google Developer Console/Microsoft Azure Portal context, which can only be completed by the client's domain administrator.
- **Impact**: Zero impact. Authentic styling is verified, and the return callback triggers the standard 2FA check dynamically.
