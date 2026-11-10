# Annotation Studio

A private annotation application for EUR-Lex, United Nations, and chemistry question–answer evaluation. The frontend uses React/TypeScript and Vinext. Server routes use local Cloudflare D1 (SQLite), individual email/password accounts, and explicit project memberships. The current setup runs locally; it does not publish or deploy the application.

## Run locally

Use **Node.js 22.18 or newer**.

```sh
cd annotation-studio
npm ci
npm run setup:local
npm run dev
```

Open the URL printed by the dev server (normally `http://localhost:5173`) and visit **`/login`**. Local email/password authentication is the default (`AUTH_MODE=local`); the starter's automatic development sign-in is disabled.

`setup:local` builds the application, applies pending local migrations, inserts nine hypothetical documents, and creates the initial accounts below. Each newly created account gets a separate generated temporary password and must change it at `/account/password` before accessing its workspace.

| Account email | Role | Assigned project |
| --- | --- | --- |
| `seedy@sites.test` | Administrator | None |
| `eurlex1@annotation.local` | Annotator | EUR-Lex |
| `eurlex2@annotation.local` | Annotator | EUR-Lex |
| `un1@annotation.local` | Annotator | United Nations |
| `chemistry1@annotation.local` | Annotator | Chemistry |

Initial passwords are written only to the ignored **`.sites-runtime/local-credentials.json`** file, with owner-only read/write permissions (`0600`). The setup command prints its location, not the passwords. This file records initial credentials; it is not updated when a user changes their password. Do not commit it or serve it as a public asset.

After signing in as `seedy@sites.test` and changing its temporary password, the administrator goes to `/admin`. Open **Qualification**, review the proposed answers against the supplied PDFs, and explicitly confirm each domain's key. Annotators sign in with their own accounts and see only their assigned project. They read and acknowledge its guideline, pass all ten qualification questions, and then annotate documents. A later visit to an already qualified project opens annotation directly.

Re-running `setup:local` does **not** reset existing passwords, recreate removed project assignments, or replace saved work. It does not create qualifications or confirm answer keys. When upgrading the earlier development setup, it removes only the legacy `local_seedy` / `seedy@sites.test` project memberships so that the administrator no longer belongs to all three projects; existing annotations, acknowledgments, and passes remain stored. If other existing accounts have conflicting multiple-project assignments, setup stops for those assignments to be resolved instead of silently choosing a project. The command works only on the local database and requires `AUTH_MODE=local`.

`/?demo=1` provides an interactive sample workspace without sign-in and follows the same guideline → test → annotation sequence. Demo guideline acknowledgments and passes are kept per project in this browser tab’s session storage; they never create live qualifications. Demo submissions are explicitly labeled, remain in memory, and are **not** server submissions. Use the signed-in local workflow to test real persistence.

## Hypothetical CSV datasets

The three files in `public/samples/` have exactly these columns:

```csv
document,question,answer
```

Each file contains three hypothetical examples, including deliberately flawed answers. They are not actual EUR-Lex instruments, UN records, or chemistry publications. The same examples power the demo and local setup. Administration lets you download, preview, and import them, or replace them with real CSVs. Embedded commas, quotes, multiline fields, UTF-8, and a UTF-8 BOM are supported. Imports are limited to 500 rows/12 MB per request; duplicate content or IDs reject the entire batch without overwriting documents.

## Accounts and access

Each person uses a separate account. Local roles come from account records in the database: there is no first-user administrator, shared annotator password, self-selected role, or public signup. The administrator account has no annotation project. Annotators can belong to **one project at a time**, and each project can have **multiple annotators**. Project and identity checks run on the server, including document, PDF, qualification, and submission routes. Each annotator sees only their own submitted ratings.

The administrator can create an annotator account for a project, assign an existing unassigned annotator, remove an assignment, reset an annotator's password, or disable or re-enable their account. Assigning an annotator who already belongs to another project is rejected. Password resets require another password change at the next sign-in; password changes and resets invalidate earlier sessions. Disabled accounts cannot sign in or continue using existing sessions. These operations preserve submitted annotations. The administrator can manage all three projects and export their annotations, but cannot use the administrator account to annotate.

Creating or resetting an account does **not** send an email. The administrator must deliver the temporary credentials to the intended annotator separately. Users can later choose **Change password** from their account navigation. Signing out invalidates the session without deleting recovery drafts.

Local configuration is read from the ignored `.dev.vars` file. `setup:local` creates or adds `AUTH_MODE="local"` when needed; it refuses to override an explicitly selected different mode. `.env.example` documents the supported variable names.

A legacy ChatGPT authentication adapter remains available only when `AUTH_MODE=chatgpt` is explicitly configured. In that mode, `ADMIN_EMAILS` and `ADMIN_USER_IDS` configure administrator identity. Those variables do not grant administrator rights to local password accounts. The current local setup does not use that adapter, mock authentication, or hosted deployment.

## Guidelines and qualification

The two supplied PDFs are embedded server-side and served through protected project routes. Onboarding has three separate steps: **guideline → qualification test → annotation**. The annotator must acknowledge the guideline before the test is available; all ten answers must be correct before any real document content or titles are returned. The final-page ten-question tests are transcribed exactly. Neither PDF includes an official answer key: the admin screen labels the derived key as proposed and requires explicit confirmation.

A pass is required once per annotator per project, including separate passes for EUR-Lex and UN. Failed attempts can be retried. After passing, the annotator goes directly to annotation on later visits and is not asked to repeat the guideline acknowledgment or test.

Changing a confirmed answer key requires a new version for audit, but does not invalidate existing passes or require another test. Revisions apply only to annotators who have not yet passed that project. Historical keys, qualification attempts, and the original key version and time of each successful pass are retained. Exports preserve key history and the original qualification version and pass time associated with each annotation.

Eight criteria are transcribed from the PDFs. Scores are integers 1–5. Scores 1–3 require a problem explanation; a 5 requires an exceptional-strength explanation. Chemistry requires a brief reason for every score. Numerical fidelity can be marked not applicable, recorded as 4 with “not applicable.” “Cannot assess” requires a reason. The overall document comment is optional.

## Saving and recovery

**Submit saves that document immediately.** The server validates the entire record and atomically inserts all eight ratings, criterion comments, and the document comment into one immutable row. Database uniqueness allows only one submission per annotator/document and one use of a request ID per annotator. The UI waits for a persisted receipt before reporting success, locking the saved review, or offering the next document.

Retries use the same request ID and payload. An identical retry returns the original receipt. A conflicting retry returns HTTP 409 and never overwrites a saved review. A D1 primary session provides read-after-write confirmation. Project membership and the annotator’s saved project pass are rechecked in the insert statement, including if access changed while the form was open. A later answer-key revision does not block a previously qualified annotator from saving.

Account-bound annotation requests also send the identity of the annotator who opened the form. If another browser tab signs in as a different account, the server rejects the mismatched request without saving under that account. An expired session or account mismatch keeps the original draft and request ID. Sign in again as the original annotator, then use **Check session** before retrying the unchanged submission.

The browser keeps a recovery draft scoped to user/project/document when local storage is available. A draft is not a submission or backup. Failed or ambiguous requests retain the form and original request ID. While confirmation is uncertain, the original payload stays locked for retry. Unsaved navigation prompts help prevent accidental loss. Once the server confirms a submission, the recovery draft is removed. Saved reviews are read from the server on reopening.

Use the admin export controls to download JSON containing all ratings, comments, documents, identities, receipts, and qualification versions. For paid annotation work, configure and verify regular database backups and a restore procedure; the application does not schedule backups. The current database is stored under local `.wrangler/state`, which is ignored by Git. Do not delete this directory if you need to retain accounts, qualifications, or submissions. Browser recovery drafts and the initial-credentials file are not database backups.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Tests exercise password-backed sessions, account roles, forced password changes, resets and disabled accounts, single-project membership, safe return paths, and expected-identity checks. Backend tests run the application SQL/migrations against real SQLite and inject failures. They also cover project/user isolation, ordered guideline and qualification gating, persistent project passes across key revisions, input validation, atomic imports, immutable saving, concurrent retries, failed writes, lost acknowledgements, revocation, key versioning, and receipt persistence after closing and reopening the database. This verifies application behavior; it is not a promise that storage devices or networks can never fail.

Migrations are generated with `npm run db:generate`. Commit schema changes with generated SQL and Drizzle metadata. Applied migrations must not be edited. `setup:local` applies pending migrations to the local database without publishing the application.
