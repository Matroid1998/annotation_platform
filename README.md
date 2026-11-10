# Annotation platform

The application is in [`annotation-studio/`](annotation-studio/README.md).

```sh
cd annotation-studio
npm ci
npm run setup:local
npm run dev
```

Requires Node.js 22.18+. This setup runs locally with individual email/password accounts (`AUTH_MODE=local`); automatic mock sign-in is disabled. Open `/login` on the URL printed by the server.

Setup creates the administrator account **`seedy@sites.test`**, with no annotation project, and four annotators: `eurlex1@annotation.local` and `eurlex2@annotation.local` for EUR-Lex, `un1@annotation.local` for United Nations, and `chemistry1@annotation.local` for chemistry. Initial passwords are in the ignored, owner-readable [`annotation-studio/.sites-runtime/local-credentials.json`](annotation-studio/.sites-runtime/local-credentials.json) file. Accounts sign in directly with their assigned passwords. Users cannot change their own passwords; administrators can reset annotator passwords. Passwords are never included in this documentation.

Administrators manage accounts, assignments, datasets, qualification keys, and exports at `/admin`. Each annotator has access to one project and only their own ratings; a project can have many annotators. Account creation and password resets do not send emails. Re-running setup preserves existing passwords and saved work and does not restore removed assignments. It removes the earlier development administrator's three project memberships without deleting their historical work.

Local setup configures the guideline-derived legal and chemistry qualification keys so tests can be submitted immediately. It also includes three hypothetical CSV datasets with `document`, `question`, and `answer` columns. The original legal and chemistry guideline PDFs remain in this directory.

Annotators complete three separate steps for their assigned project: acknowledge the guideline, pass the qualification test with all answers correct, then annotate. A successful pass is saved once per annotator/project; later visits and answer-key revisions do not require another test. Each submitted document is saved immediately, and uncertain saves retain their original draft and request ID for safe retry. Switching accounts in another tab cannot silently attribute a pending annotation to the new account.

See the [application README](annotation-studio/README.md) for account management, backups, sample mode, and verification. No hosting or publishing is performed by local setup.
