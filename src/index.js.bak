import 'dotenv/config';
import { Markup, Telegraf, session } from 'telegraf';
import {
  approveToken,
  boostVotes,
  canTelegramVote,
  castTelegramVote,
  getApprovedTokens,
  getMyListings,
  getTokenByAddress,
  recordPaymentIntent,
  rejectToken,
  searchTokens,
  submitToken,
  upsertTelegramUser,
} from './db.js';

const botToken = process.env.BOT_TOKEN;
if (!botToken) throw new Error('Missing BOT_TOKEN');

const bot = new Telegraf(botToken);
const siteUrl = process.env.SITE_URL || 'https://tongemz.vercel.app';
const supportHandle = process.env.SUPPORT_HANDLE || '@TonGemzSupport';
const channelHandle = process.env.CHANNEL_HANDLE || '@TonGemz';
const tonWallet = process.env.TON_PAYMENT_WALLET || 'SET_TON_PAYMENT_WALLET';
const adminIds = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);

const listingPrices = {
  free: '0 TON',
  fast: '5 TON',
  promoted: '12 TON',
  premium: '20 TON',
  banner: '15 TON/day',
};

bot.use(session({ defaultSession: () => ({ flow: null, data: {} }) }));
bot.use(async (ctx, next) => {
  if (ctx.from) await upsertTelegramUser(ctx.from);
  return next();
});

function isAdmin(ctx) {
  return ctx.from?.id && adminIds.has(String(ctx.from.id));
}

function mainKeyboard() {
  return Markup.keyboard([
    ['🚀 Submit', '🗳 Vote'],
    ['💎 Prices', '🎯 Banner'],
    ['📄 My Listing', '📈 Status'],
    ['🆘 Support'],
  ]).resize();
}

function cancelKeyboard() {
  return Markup.keyboard([['❌ Cancel']]).resize();
}

function packagesKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Free', 'tier:free'), Markup.button.callback('Fast', 'tier:fast')],
    [Markup.button.callback('Promoted', 'tier:promoted'), Markup.button.callback('Premium', 'tier:premium')],
  ]);
}

async function sendStart(ctx) {
  await ctx.reply(
    `Welcome to TonGemz.\n\nUse this bot to submit a token, vote once every 24h, book banner ads, and check your listing status.`,
    mainKeyboard(),
  );
}

bot.start(sendStart);
bot.hears('💎 Prices', async (ctx) => {
  await ctx.reply(
    `TonGemz listing prices\n\nFree — ${listingPrices.free}\nFast — ${listingPrices.fast}\nPromoted — ${listingPrices.promoted}\nPremium — ${listingPrices.premium}\nBanner — ${listingPrices.banner}\n\nUse /submit to begin.`,
    mainKeyboard(),
  );
});
bot.command('prices', async (ctx) => {
  await ctx.reply(
    `TonGemz listing prices\n\nFree — ${listingPrices.free}\nFast — ${listingPrices.fast}\nPromoted — ${listingPrices.promoted}\nPremium — ${listingPrices.premium}\nBanner — ${listingPrices.banner}`,
    mainKeyboard(),
  );
});

function startSubmitFlow(ctx) {
  ctx.session.flow = 'submit_name';
  ctx.session.data = {};
  return ctx.reply('Send the project name.', cancelKeyboard());
}

bot.command('submit', startSubmitFlow);
bot.hears('🚀 Submit', startSubmitFlow);

bot.action(/^tier:(.+)$/, async (ctx) => {
  const tier = ctx.match[1];
  ctx.session.data.listing_tier = tier;
  await ctx.answerCbQuery(`Selected ${tier}`);
  await ctx.editMessageText(
    `Listing package: ${tier.toUpperCase()}\nPrice: ${listingPrices[tier] || 'custom'}\n\nSend the token description now.`,
  );
  ctx.session.flow = 'submit_description';
});

function startVoteFlow(ctx) {
  ctx.session.flow = 'vote_address';
  ctx.session.data = {};
  return ctx.reply('Send the token contract address you want to vote for.', cancelKeyboard());
}

bot.command('vote', async (ctx) => {
  const address = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!address) return startVoteFlow(ctx);
  return handleVote(ctx, address);
});
bot.hears('🗳 Vote', startVoteFlow);

async function handleVote(ctx, address) {
  const token = await getTokenByAddress(address);
  if (!token || token.status !== 'approved') {
    return ctx.reply('Token not found or not approved yet.', mainKeyboard());
  }

  const existing = await canTelegramVote(ctx.from.id, address);
  if (existing?.created_at) {
    const nextVoteAt = new Date(new Date(existing.created_at).getTime() + 24 * 60 * 60 * 1000);
    return ctx.reply(`You already voted for ${token.symbol}. Next vote time: ${nextVoteAt.toLocaleString()}`, mainKeyboard());
  }

  const updated = await castTelegramVote(ctx.from.id, address);
  return ctx.reply(
    `Vote counted for ${updated.name} (${updated.symbol})\n24h votes: ${updated.votes_24h}\nAll-time votes: ${updated.votes_all_time}`,
    Markup.inlineKeyboard([[Markup.button.url('Open token page', `${siteUrl}/token/${encodeURIComponent(address)}`)]]),
  );
}

bot.command('status', async (ctx) => {
  const address = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!address) {
    ctx.session.flow = 'status_address';
    return ctx.reply('Send the contract address you want to check.', cancelKeyboard());
  }
  const token = await getTokenByAddress(address);
  if (!token) return ctx.reply('No listing found for that address.', mainKeyboard());
  return ctx.reply(
    `${token.name} (${token.symbol})\nStatus: ${token.status}\nTier: ${token.listing_tier || 'free'}\nPromoted: ${token.promoted ? 'Yes' : 'No'}\nVotes: ${token.votes_all_time || 0} public + ${token.admin_boost_votes || 0} boost`,
    mainKeyboard(),
  );
});
bot.hears('📈 Status', async (ctx) => {
  ctx.session.flow = 'status_address';
  ctx.session.data = {};
  return ctx.reply('Send the contract address you want to check.', cancelKeyboard());
});

bot.command('mylisting', async (ctx) => {
  const rows = await getMyListings(ctx.from.id);
  if (!rows.length) return ctx.reply('No listings found under your Telegram account yet.', mainKeyboard());
  const text = rows
    .map((row, i) => `${i + 1}. ${row.name} (${row.symbol})\n${row.address}\nStatus: ${row.status} • Tier: ${row.listing_tier}`)
    .join('\n\n');
  return ctx.reply(text, mainKeyboard());
});
bot.hears('📄 My Listing', async (ctx) => {
  const rows = await getMyListings(ctx.from.id);
  if (!rows.length) return ctx.reply('No listings found under your Telegram account yet.', mainKeyboard());
  const text = rows
    .map((row, i) => `${i + 1}. ${row.name} (${row.symbol})\n${row.address}\nStatus: ${row.status} • Tier: ${row.listing_tier}`)
    .join('\n\n');
  return ctx.reply(text, mainKeyboard());
});

function startBannerFlow(ctx) {
  ctx.session.flow = 'banner_title';
  ctx.session.data = { kind: 'banner' };
  return ctx.reply('Send the banner title or project name.', cancelKeyboard());
}

bot.command('banner', startBannerFlow);
bot.hears('🎯 Banner', startBannerFlow);

bot.command('support', async (ctx) => ctx.reply(`Support: ${supportHandle}`, mainKeyboard()));
bot.hears('🆘 Support', async (ctx) => ctx.reply(`Support: ${supportHandle}`, mainKeyboard()));

bot.command('top', async (ctx) => {
  const tokens = await getApprovedTokens(10);
  if (!tokens.length) return ctx.reply('No approved tokens yet.', mainKeyboard());
  const text = tokens
    .map((token, i) => `${i + 1}. ${token.name} (${token.symbol})\n${token.address}\nVotes: ${token.votes_all_time || 0} public + ${token.admin_boost_votes || 0} boost${token.promoted ? ' • promoted' : ''}`)
    .join('\n\n');
  return ctx.reply(text, mainKeyboard());
});

bot.command('pending', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const rows = await searchTokens('');
  const pending = rows.filter((row) => row.status === 'pending');
  if (!pending.length) return ctx.reply('No pending tokens.');
  return ctx.reply(pending.map((row) => `${row.name} (${row.symbol})\n${row.address}`).join('\n\n'));
});

bot.command('approve', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const address = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!address) return ctx.reply('Usage: /approve <contract_address>');
  await approveToken(address);
  return ctx.reply(`Approved ${address}`);
});

bot.command('reject', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const [, ...args] = ctx.message.text.split(' ').slice(1);
  const address = ctx.message.text.split(' ')[1];
  const reason = args.join(' ') || 'Rejected by admin';
  if (!address) return ctx.reply('Usage: /reject <contract_address> <reason>');
  await rejectToken(address, reason);
  return ctx.reply(`Rejected ${address}`);
});

bot.command('boost', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const parts = ctx.message.text.split(' ').slice(1);
  const [address, amountText, ...reasonParts] = parts;
  const amount = Number(amountText);
  if (!address || !Number.isFinite(amount)) {
    return ctx.reply('Usage: /boost <contract_address> <amount> [reason]');
  }
  const totalBoost = await boostVotes(address, amount, reasonParts.join(' ') || 'manual boost');
  return ctx.reply(`Boosted ${address} by ${amount}. Total boost votes: ${totalBoost}`);
});

bot.command('search', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const term = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!term) return ctx.reply('Usage: /search <name|symbol|address>');
  const rows = await searchTokens(term);
  if (!rows.length) return ctx.reply('No matches found.');
  return ctx.reply(rows.map((row) => `${row.name} (${row.symbol})\n${row.address}\n${row.status}`).join('\n\n'));
});

bot.hears('❌ Cancel', async (ctx) => {
  ctx.session.flow = null;
  ctx.session.data = {};
  await ctx.reply('Cancelled.', mainKeyboard());
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const flow = ctx.session.flow;
  if (!flow) return;

  if (flow === 'submit_name') {
    ctx.session.data.name = text;
    ctx.session.flow = 'submit_symbol';
    return ctx.reply('Send the token symbol/ticker.', cancelKeyboard());
  }
  if (flow === 'submit_symbol') {
    ctx.session.data.symbol = text.replace(/^\$/,'').toUpperCase();
    ctx.session.flow = 'submit_address';
    return ctx.reply('Send the contract address.', cancelKeyboard());
  }
  if (flow === 'submit_address') {
    ctx.session.data.address = text;
    ctx.session.flow = 'submit_telegram';
    return ctx.reply('Send the Telegram link or @handle.', cancelKeyboard());
  }
  if (flow === 'submit_telegram') {
    ctx.session.data.telegram = text;
    ctx.session.flow = 'submit_twitter';
    return ctx.reply('Send the X/Twitter link or type - to skip.', cancelKeyboard());
  }
  if (flow === 'submit_twitter') {
    ctx.session.data.twitter = text === '-' ? null : text;
    ctx.session.flow = 'submit_website';
    return ctx.reply('Send the website link or type - to skip.', cancelKeyboard());
  }
  if (flow === 'submit_website') {
    ctx.session.data.website = text === '-' ? null : text;
    ctx.session.flow = 'submit_logo';
    return ctx.reply('Send the logo image URL or type - to use placeholder.', cancelKeyboard());
  }
  if (flow === 'submit_logo') {
    ctx.session.data.logo_url = text === '-' ? `${siteUrl}/placeholder-token.png` : text;
    ctx.session.flow = 'submit_tier';
    return ctx.reply('Choose a listing package.', packagesKeyboard());
  }
  if (flow === 'submit_description') {
    ctx.session.data.description = text;
    const paymentReference = `TG-${ctx.from.id}-${Date.now()}`;
    const payload = {
      name: ctx.session.data.name,
      symbol: ctx.session.data.symbol,
      address: ctx.session.data.address,
      description: ctx.session.data.description,
      logo_url: ctx.session.data.logo_url,
      website: ctx.session.data.website,
      telegram: ctx.session.data.telegram,
      twitter: ctx.session.data.twitter,
      listing_tier: ctx.session.data.listing_tier || 'free',
      status: ctx.session.data.listing_tier === 'free' ? 'pending' : 'pending',
      submitted_by_telegram_id: String(ctx.from.id),
      submitted_by_username: ctx.from.username || null,
      payment_reference: paymentReference,
      source: 'telegram',
    };
    const row = await submitToken(payload);
    if ((ctx.session.data.listing_tier || 'free') !== 'free') {
      await recordPaymentIntent({
        token_address: row.address,
        payer_reference: paymentReference,
        telegram_id: String(ctx.from.id),
        kind: 'listing',
        amount_ton: ctx.session.data.listing_tier === 'fast' ? 5 : ctx.session.data.listing_tier === 'promoted' ? 12 : 20,
        status: 'pending',
      });
    }
    ctx.session.flow = null;
    ctx.session.data = {};
    return ctx.reply(
      `Submission received for ${row.name} (${row.symbol}).\nStatus: ${row.status}\nPackage: ${row.listing_tier}\nPayment ref: ${paymentReference}\n\n${row.listing_tier === 'free' ? 'No payment needed. We will review it.' : `Send payment to ${tonWallet} and keep your payment ref.`}`,
      mainKeyboard(),
    );
  }
  if (flow === 'vote_address') {
    ctx.session.flow = null;
    ctx.session.data = {};
    return handleVote(ctx, text);
  }
  if (flow === 'status_address') {
    ctx.session.flow = null;
    const token = await getTokenByAddress(text);
    if (!token) return ctx.reply('No listing found for that address.', mainKeyboard());
    return ctx.reply(
      `${token.name} (${token.symbol})\nStatus: ${token.status}\nTier: ${token.listing_tier || 'free'}\nPublic votes: ${token.votes_all_time || 0}\nBoost votes: ${token.admin_boost_votes || 0}`,
      mainKeyboard(),
    );
  }
  if (flow === 'banner_title') {
    ctx.session.data.title = text;
    ctx.session.flow = 'banner_link';
    return ctx.reply('Send the project link for the banner.', cancelKeyboard());
  }
  if (flow === 'banner_link') {
    ctx.session.data.target_url = text;
    ctx.session.flow = 'banner_duration';
    return ctx.reply('Send the banner duration in days.', cancelKeyboard());
  }
  if (flow === 'banner_duration') {
    const days = Number(text);
    if (!Number.isFinite(days) || days <= 0) return ctx.reply('Send a valid number of days.');
    const paymentReference = `BANNER-${ctx.from.id}-${Date.now()}`;
    await recordPaymentIntent({
      token_address: null,
      payer_reference: paymentReference,
      telegram_id: String(ctx.from.id),
      kind: 'banner',
      amount_ton: days * 15,
      status: 'pending',
      notes: JSON.stringify({ title: ctx.session.data.title, target_url: ctx.session.data.target_url, days }),
    });
    ctx.session.flow = null;
    ctx.session.data = {};
    return ctx.reply(
      `Banner request saved.\nDuration: ${days} day(s)\nAmount: ${days * 15} TON\nWallet: ${tonWallet}\nPayment ref: ${paymentReference}\n\nAfter payment, send proof to ${supportHandle}.`,
      mainKeyboard(),
    );
  }
});

bot.catch(async (err, ctx) => {
  console.error('Bot error', err);
  try {
    await ctx.reply('Something went wrong. Please try again.');
  } catch {}
});

bot.launch();
console.log('TonGemz bot is running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
