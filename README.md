# SECRET — Human Decision Experiment

A responsive React MVP for anonymous group decision experiments.

## Included in this first implementation

- Premium dark responsive landing page
- Create a room with a six-character PIN
- Join a room from another device when Supabase is configured
- Six starter questions
- Anonymous participant IDs stored locally in the browser
- Initial private answer round and post-reveal reflection round
- Host overview and answer distributions
- Lightweight answer-pattern clustering and overlap signals
- Transparent baseline prediction estimate
- Supabase Realtime subscriptions plus polling fallback
- Local demo mode without cloud credentials

## Important modes

### Local demo mode
If Supabase environment variables are not set, the app stores data in the current browser's localStorage. This is useful for previewing the interface on one device, but rooms and votes are NOT shared with other devices or browsers.

### Shared cloud mode
To let multiple phones/laptops join the same room:

1. Create a free Supabase project at https://supabase.com.
2. Open SQL Editor in your Supabase project.
3. Run the complete contents of `supabase/schema.sql`.
4. In Project Settings → API, copy the Project URL and anon/public key.
5. Copy `.env.example` to `.env` and fill:
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
6. Restart the dev server.

The anon key is designed for browser use; never put a Supabase service-role key in frontend code.

## Run locally

Install Node.js 20 or newer, then:

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. On a phone, the development computer and phone must be on the same Wi-Fi; use the network URL printed by Vite if available.

Build for production:

```bash
npm run build
npm run preview
```

## Deploy frontend

A simple option is Vercel:

1. Push this project to a private GitHub repository.
2. Import the repository into Vercel.
3. Set the two VITE_SUPABASE environment variables in Vercel project settings.
4. Deploy.

For a public demonstration, configure Supabase first so participants on separate devices share data.

## Current MVP limitations / next engineering tasks

- The clustering algorithm is a simple similarity-threshold grouping, not a validated psychological classifier.
- The prediction is a transparent baseline estimate, not a trained or validated ML model.
- Current host controls are prototype-level. Anyone with the room code can potentially interact with room data under the included demo policies.
- Participants can revise their answer in the reflection phase; this is recorded separately from initial answers.
- The app currently uses a fixed set of six starter questions. A question editor, moderation, export, QR generation, host authentication, and production-grade security are planned follow-ups.
- Do not collect sensitive personal data. Explain the experiment and obtain consent before participation.

## Project structure

```text
secret-project/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── README.md
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── styles.css
│   └── lib/
│       ├── supabase.js
│       ├── store.js
│       └── engine.js
└── supabase/
    └── schema.sql
```
