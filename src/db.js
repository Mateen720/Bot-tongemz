import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const COOLDOWN_HOURS = 24;

export function nowIso() {
  return new Date().toISOString();
}

export function voteCutoffIso() {
  return new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
}

function normalizeAddress(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isMissingColumn(error, column) {
  const msg = String(error?.message || error || '');
  return msg.includes(column) || msg.includes(`column \"${column}\"`);
}

function isMissingTable(error, table) {
  const msg = String(error?.message || error || '');
  return msg.includes(`relation \"${table}\"`) || msg.includes(`table \"${table}\"`);
}

export async function upsertTelegramUser(from) {
  if (!from?.id) return;
  try {
    await supabase.from('telegram_users').upsert({
      telegram_id: String(from.id),
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      updated_at: nowIso(),
    }, { onConflict: 'telegram_id' });
  } catch (error) {
    console.error('upsertTelegramUser failed', error);
  }
}

export async function getApprovedTokens(limit = 10) {
  const { data, error } = await supabase
    .from('tokens')
    .select('name,symbol,address,votes_all_time,votes_24h,admin_boost_votes,promoted,status')
    .eq('status', 'approved')
    .order('promoted', { ascending: false })
    .order('votes_all_time', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getTokenByAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  let { data, error } = await supabase
    .from('tokens')
    .select('*')
    .eq('address', normalized)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: alt, error: altError } = await supabase
    .from('tokens')
    .select('*')
    .ilike('address', normalized)
    .limit(1)
    .maybeSingle();
  if (altError) throw altError;
  return alt;
}

export async function submitToken(payload) {
  const insertPayload = {
    category: 'General',
    promoted: false,
    votes_24h: 0,
    votes_all_time: 0,
    admin_boost_votes: 0,
    source: 'telegram',
    status: 'pending',
    ...payload,
    address: normalizeAddress(payload.address),
  };

  const { data, error } = await supabase
    .from('tokens')
    .insert(insertPayload)
    .select('id,name,symbol,address,status,listing_tier,payment_reference')
    .single();
  if (error) throw error;
  return data;
}

export async function canTelegramVote(telegramId, address) {
  try {
    const { data, error } = await supabase
      .from('vote_logs')
      .select('created_at')
      .eq('token_address', normalizeAddress(address))
      .eq('voter_key', `tg:${telegramId}`)
      .gte('created_at', voteCutoffIso())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (error) {
    if (isMissingTable(error, 'vote_logs')) {
      console.error('vote_logs table missing, skipping cooldown check');
      return null;
    }
    throw error;
  }
}

export async function castTelegramVote(telegramId, address) {
  const normalized = normalizeAddress(address);
  const token = await getTokenByAddress(normalized);
  if (!token) throw new Error('Token not found');
  const currentAllTime = Number(token.votes_all_time || 0);
  const current24h = Number(token.votes_24h || 0);

  const { data, error: updateError } = await supabase
    .from('tokens')
    .update({ votes_all_time: currentAllTime + 1, votes_24h: current24h + 1 })
    .eq('address', normalized)
    .select('name,symbol,address,votes_all_time,votes_24h,admin_boost_votes')
    .single();
  if (updateError) throw updateError;

  try {
    const { error: logError } = await supabase.from('vote_logs').insert({
      token_address: normalized,
      voter_key: `tg:${telegramId}`,
      source: 'telegram',
    });
    if (logError) throw logError;
  } catch (error) {
    if (!isMissingTable(error, 'vote_logs')) throw error;
    console.error('vote_logs insert skipped because table is missing');
  }

  return data || { ...token, votes_all_time: currentAllTime + 1, votes_24h: current24h + 1 };
}

export async function getMyListings(telegramId) {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('name,symbol,address,status,listing_tier,promoted,listed_at,payment_reference,submitted_by_telegram_id')
      .eq('submitted_by_telegram_id', String(telegramId))
      .order('listed_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return data || [];
  } catch (error) {
    if (isMissingColumn(error, 'submitted_by_telegram_id')) {
      console.error('submitted_by_telegram_id column missing; returning no listings');
      return [];
    }
    throw error;
  }
}

export async function recordPaymentIntent(payload) {
  try {
    const { error } = await supabase.from('payments').insert(payload);
    if (error) throw error;
  } catch (error) {
    if (isMissingTable(error, 'payments')) {
      console.error('payments table missing, skipping payment intent record');
      return;
    }
    throw error;
  }
}

export async function approveToken(address) {
  const { error } = await supabase
    .from('tokens')
    .update({ status: 'approved' })
    .eq('address', normalizeAddress(address));
  if (error) throw error;
}

export async function rejectToken(address, reason = null) {
  const { error } = await supabase
    .from('tokens')
    .update({ status: 'rejected', admin_notes: reason })
    .eq('address', normalizeAddress(address));
  if (error) throw error;
}

export async function boostVotes(address, amount, reason = 'manual boost') {
  const normalized = normalizeAddress(address);
  const token = await getTokenByAddress(normalized);
  if (!token) throw new Error('Token not found');
  const numericAmount = Number(amount || 0);
  const nextBoost = Number(token.admin_boost_votes || 0) + numericAmount;
  const { error: updateError } = await supabase
    .from('tokens')
    .update({ admin_boost_votes: nextBoost })
    .eq('address', normalized);
  if (updateError) throw updateError;

  try {
    const { error: logError } = await supabase.from('admin_actions').insert({
      token_address: normalized,
      action: 'boost_votes',
      value: numericAmount,
      reason,
    });
    if (logError) throw logError;
  } catch (error) {
    if (!isMissingTable(error, 'admin_actions')) throw error;
    console.error('admin_actions table missing, skipping action log');
  }
  return nextBoost;
}

export async function searchTokens(term) {
  const like = `%${String(term || '').trim()}%`;
  const { data, error } = await supabase
    .from('tokens')
    .select('name,symbol,address,status,votes_all_time,admin_boost_votes')
    .or(`name.ilike.${like},symbol.ilike.${like},address.ilike.${like}`)
    .order('listed_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}
