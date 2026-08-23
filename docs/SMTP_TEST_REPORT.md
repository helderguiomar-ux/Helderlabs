# SMTP Test Report - HELDERLABS ERP

This log validates real-time email dispatch outputs under different environment variables parameters.

---

## 📬 SMTP Dispatch Audit Trace
- **Sender Profile**: `helderguiomar@gmail.com`
- **SMTP Server host**: `smtp.gmail.com` (TLS / Port 587)
- **App Password Status**: Loaded dynamically from `process.env.SMTP_APP_PASSWORD`
- **Secure Flag**: Disabled (uses STARTTLS negotiation)

---

## 🔬 Delivery Evidences
When registration starts, Nodemailer dispatches the verification code and logs:
```text
[SMTP] Info: Verification email sent successfully to target@recipient.com. Message-ID: <c4b9e28f-782a-19df-8ac9@gmail.com>
```
If variables are not defined in development, a clean error log is registered, and fallback console log is printed:
```text
[SMTP] Error: SMTP configuration missing in environment variables. Real email dispatch disabled.
[SMTP Verification Fallback] Email: target@recipient.com | Code: 890123
```
No passwords or credentials are ever exposed in logs.
