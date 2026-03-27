# TonGemz Telegram Bot

This is the live Telegram bot for TonGemz. It connects to the same Supabase project as the website.

## What it does
- `/start` main menu
- `/submit` token submission flow
- `/vote <contract>` one vote per token per 24h
- `/prices` listing and banner prices
- `/status <contract>` listing status lookup
- `/mylisting` user's own listings
- `/banner` banner booking request flow
- `/support` support contact
- Admin commands: `/approve`, `/reject`, `/boost`, `/search`, `/pending`

## Deploy on Railway
1. Create a new Railway service from this folder.
2. Add env vars from `.env.example`.
3. Set start command to `npm start`.
4. Deploy.

## Required env vars
- `BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TELEGRAM_IDS`
- `SITE_URL`
- `TON_PAYMENT_WALLET`

## Notes
- The bot uses long polling by default.
- It writes to the shared `tokens`, `vote_logs`, `payments`, `telegram_users`, and `admin_actions` tables.
- Website voting and Telegram voting share the same 24h cooldown logic through `vote_logs`.
