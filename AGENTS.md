# Contributor Agent Instructions

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing this repository. Follow its contribution, verification, and security-reporting guidance.
- Keep changes focused on the requested issue, preserve unrelated work, and report the checks run and any remaining limitations.
- Use synthetic data for local verification. Keep credentials, customer information, and operator-specific instructions out of committed files.
- When changing proxy message logging, preserve the distinction between individual staff replies and automated messages. Review `apps/worker/src/routes/line-proxy.ts` for the `X-Line-Harness-Source: manual` contract and its push-only validation.
- When changing consultation scheduling, review `apps/worker/src/routes/meet-consultations.ts` and `apps/worker/src/services/meet-consultation-reminders.ts` together so registration, updates, cancellation, and reminder behavior stay consistent.
- A code change does not itself authorize production deployment, real message delivery, or changes to a user's calendar.
