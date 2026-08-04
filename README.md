# Skymap QMS

Enterprise pharmaceutical Quality Management System for Skymap Pharmaceuticals — GMP, FDA 21 CFR Part 11, and WHO aligned.

**Developed by:** Satyajit Patri

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Firebase** — Authentication, Firestore, Storage, Cloud Functions
- **TanStack Query**, Recharts, React Hook Form, Zod

## Modules

- **QMS** — Deviation, OOS, CAPA, Change Control, Complaints, Recall, Risk, DMS, and more
- **CPV** — Continued Process Verification (CPP/CQA, SPC, trends, monitoring)
- **PQR** — Product Quality Review workflows
- **Manufacturing** — Batches & products
- **Admin** — Users, roles, masters, system settings, audit trail

## Setup

```bash
npm install
cp .env.example .env.local
# Fill NEXT_PUBLIC_FIREBASE_* from Firebase Console → Project settings
npm run setup:admin   # optional: bootstrap default admin
npm run dev           # http://localhost:3001
```

See `.env.example` for all variables.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (port 3001) |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run emulators` | Firebase emulators |
| `npm run deploy:functions` | Deploy Cloud Functions |

## Security

- Firebase Auth + role-based access
- Middleware session protection
- Immutable audit trail
- E-signature support for controlled actions
