# Annotation Studio

A private annotation application for EUR-Lex, United Nations, and chemistry question–answer evaluation. The frontend uses React/TypeScript and Vinext. Server routes use Cloudflare D1 (SQLite), explicit project memberships, and authenticated user identity.

## Run locally

Use **Node.js 22.18 or newer**.

```sh
cd annotation-studio
npm ci
npm run setup:local
npm run dev
```

Open the URL printed by the dev server (normally `http://localhost:5173`). Sign in with the local development identity, then open **Administration → Qualification keys**. Review the proposed answers against the supplied PDFs and explicitly confirm each domain's key. Return to a project, answer all ten qualification questions correctly, and annotate its documents.

`setup:local` builds the application, applies pending local migrations, and inserts nine hypothetical documents plus the local `seedy@sites.test` membership for all three projects. It does not create qualifications, confirm answer keys, or touch the hosted database. Re-running it preserves submitted work. Development sign-in is provided by the starter only for loopback development; it is absent from production builds.

`/?demo=1` provides an interactive sample workspace without sign-in. Demo submissions are explicitly labeled, remain in memory, and are **not** server submissions. Use the signed-in local workflow to test real persistence.

## Hypothetical CSV datasets

The three files in `public/samples/` have exactly these columns:

```csv
document,question,answer
```

Each file contains three hypothetical examples, including deliberately flawed answers. They are not actual EUR-Lex instruments, UN records, or chemistry publications. The same examples power the demo and local setup. Administration lets you download, preview, and import them, or replace them with real CSVs. Embedded commas, quotes, multiline fields, UTF-8, and a UTF-8 BOM are supported. Imports are limited to 500 rows/12 MB per request; duplicate content or IDs reject the entire batch without overwriting documents.

## Accounts and access

Hosted sign-in uses Sites' authenticated identity. Configure one or both runtime variables before assigning projects:

- `ADMIN_EMAILS`: comma-separated administrator email addresses.
- `ADMIN_USER_IDS`: comma-separated stable Site user IDs.

Local development reads these from the ignored `.dev.vars` file. `setup:local` creates that file with the local development admin only if it does not exist. `.env.example` documents variable names; production values belong in Sites runtime configuration.

There is no first-user admin, shared annotator password, or client-side role toggle. Administrators invite an email to a specific project. The invitation binds to the authenticated stable user ID on first sign-in. Every project, document, PDF, qualification, and submission endpoint checks membership. Annotators can see only their own submission records. Administrators can manage projects and export all project annotations; they need membership and qualification to annotate themselves.

New hosted Sites are owner-private. Before inviting real annotators, set the appropriate Site audience/access policy and assign project memberships separately. Site access establishes who can sign in; project membership establishes which dataset they can access.

## Guidelines and qualification

The two supplied PDFs are embedded server-side and served through protected project routes. The final-page ten-question tests are transcribed exactly. Neither PDF includes an official answer key: the admin screen labels the derived key as proposed and requires explicit confirmation. No real document content or titles are returned until all ten answers are correct. A separate pass is required for each project.

Changing the key requires a new version and requalification. Historical keys and qualification attempts are retained for audit. Exports include key history and the version associated with each annotation.

Eight criteria are transcribed from the PDFs. Scores are integers 1–5. Scores 1–3 require a problem explanation; a 5 requires an exceptional-strength explanation. Chemistry requires a brief reason for every score. Numerical fidelity can be marked not applicable, recorded as 4 with “not applicable.” “Cannot assess” requires a reason. The overall document comment is optional.

## Saving and recovery

**Submit saves that document immediately.** The server validates the entire record and atomically inserts all eight ratings, criterion comments, and the document comment into one immutable row. Database uniqueness allows only one submission per annotator/document and one use of a request ID per annotator. The UI waits for a persisted receipt before reporting success, locking the saved review, or offering the next document.

Retries use the same request ID and payload. An identical retry returns the original receipt. A conflicting retry returns HTTP 409 and never overwrites a saved review. A D1 primary session provides read-after-write confirmation. Membership and current qualification are rechecked in the insert statement, including if access changed while the form was open.

The browser keeps a recovery draft scoped to user/project/document when local storage is available. A draft is not a submission or backup. Failed or ambiguous requests retain the form and original request ID. While confirmation is uncertain, the original payload stays locked for retry. Unsaved navigation prompts help prevent accidental loss. Once the server confirms a submission, the recovery draft is removed. Saved reviews are read from the server on reopening.

Use the admin export controls to download JSON containing all ratings, comments, documents, identities, receipts, and qualification versions. For paid production work, configure and verify regular database backups and a restore procedure in your hosting environment; the application does not schedule off-platform backups. Keep the D1 database stable across deployments. Local `.wrangler/state` is development data, is ignored by Git, and must not be deleted if you need to retain local submissions.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Backend tests run production SQL/migrations against real SQLite and inject failures. They cover project/user isolation, qualification gating, input validation, atomic imports, immutable saving, concurrent retries, failed writes, lost acknowledgements, revocation, key versioning, and receipt persistence after closing and reopening the database. This verifies application behavior; it is not a promise that hosting, devices, or networks can never fail.

Migrations are generated with `npm run db:generate`. Commit schema changes with generated SQL and Drizzle metadata. Applied migrations must not be edited. Hosted deployment applies migrations independently of local preview state.
