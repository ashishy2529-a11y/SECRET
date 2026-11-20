# SECRET — Anonymous Group Decision Experiments

SECRET is a room-based group experiment that lets people answer the same questions independently, reveal the room's responses, reconsider their choices, and explore where answers overlap or differ.

## What the current app includes

- Responsive dark landing page.
- Eight-character room PINs and QR invite links.
- Anonymous participation without asking for names, email addresses, or phone numbers.
- Six starter questions in each room.
- Initial answer round followed by a separate post-reveal reflection round.
- Host room overview, response counts, reveal control, and next-round control.
- Similarity clusters, opposite-answer overlap, Hidden Connections, and Opinion Shift Analysis.
- Supabase anonymous authentication, database-backed participant IDs, row-level security, realtime updates, and polling fallback.
- Local demo mode when Supabase is not configured.

The analytics describe patterns in submitted answers. They are not psychological diagnoses or validated predictions. Forecasting is intentionally disabled until comparable historical training data exists.

## Run locally

Use Node.js 20 or newer:

```bash
npm install
npm test
npm run build
npm run dev
```

## Supabase setup

### New Supabase project

1. Create a Supabase project.
2. In Authentication settings, enable Anonymous Sign-Ins.
3. Open the SQL Editor and run the complete contents of `supabase/schema.sql`.
4. Copy the Project URL and the anon/public key from Project Settings → API.
5. Set these environment variables in your local `.env` file and in the hosting provider's environment settings:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

6. Restart the development server or redeploy the app after changing environment variables.

### Existing project

Do not rerun the fresh-install schema over an existing database. Apply the migrations in this order using the Supabase SQL Editor:

1. `supabase/migrations/20261120_secure_anonymous_access.sql`
2. `supabase/migrations/20261120_enforce_response_phase.sql`
3. `supabase/migrations/20261120_bind_participant_identity.sql`
4. `supabase/migrations/20261120_require_reveal_before_reflection.sql`

The migrations are intended to be applied once, in order. Back up important data before making database changes.

**Never put a Supabase service-role key in frontend code or a Vite environment variable.** The browser app uses only the anon/public key; database permissions must remain enforced by row-level security.

## Data and anonymity notes

- The app does not request participant names, email addresses, or phone numbers.
- Supabase anonymous authentication creates an account-like anonymous session in the browser. SECRET maps that session to an opaque participant ID within each room.
- This provides one participant identity per anonymous auth account per room, not a guarantee of one human being per vote. Clearing browser data or using another browser/device can create another anonymous session.
- Local demo mode stores data in that browser's localStorage and does not synchronize with other devices.
- Do not use SECRET to collect sensitive personal information. Explain the activity and obtain participants' consent before a demonstration.

## Analytics definitions

- **Similarity clusters:** groups participants only when their available answers meet the configured similarity threshold.
- **Opposite-answer overlap:** highlights pairs with a mix of shared and different answers.
- **Hidden Connections:** identifies pairs with sufficient shared questions and answer agreement.
- **Opinion Shift Analysis:** compares each participant's initial answers with their post-reveal answers.
- **Prediction:** currently returns no forecast; a single room does not provide valid historical training data for predicting future answers.

These are descriptive experimental signals, not validated scientific or psychological assessments.

## Quality checks

GitHub Actions runs:

- Dependency installation.
- Automated Node.js tests.
- A production Vite build.

Passing automated checks does not replace a live multi-device rehearsal. Before presenting, verify a complete room session with the actual demonstration network and devices, including joining, submitting, reveal, reflection, and analytics.

## Project structure

```text
src/
  App.jsx
  styles.css
  lib/
    engine.js
    store.js
    supabase.js
supabase/
  schema.sql
  migrations/
tests/
  engine.test.js
  schema.test.js
.github/
  workflows/
    quality-checks.yml
```
