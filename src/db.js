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

export async function upsertTelegramUser(from) {
  if (!from?.id) return;
  await supabase.from('telegram_users').upsert({
    telegram_id: String(from.id),
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    updated_at: nowIso(),
  }, { onConflict: 'telegram_id' });
}

export async function getApprovedTokens(limit = 10) {
  const { data, error } = await supabase
    .from('tokens')
    .select('name,symbol,address,votes_all_time,votes_24h,admin_boost_votes,promoted')
    .eq('status', 'approved')
    .order('promoted', { ascending: false })
    .order('votes_all_time', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getTokenByAddress(address) {
  const { data, error } = await supabase
    .from('tokens')
    .select('*')
    .eq('address', address)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function submitToken(payload) {
  const { data, error } = await supabase
    .from('tokens')
    .insert(payload)
    .select('id,name,symbol,address,status,listing_tier,payment_reference')
    .single();
  if (error) throw error;
  return data;
}

export async function canTelegramVote(telegramId, address) {
  const { data, error } = await supabase
    .from('vote_logs')
    .select('created_at')
    .eq('token_address', address)
    .eq('voter_key', `tg:${telegramId}`)
    .gte('created_at', voteCutoffIso())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function castTelegramVote(telegramId, address) {
  const token = await getTokenByAddress(address);
  if (!token) throw new Error('Token not found');
  const currentAllTime = Number(token.votes_all_time || 0);
  const current24h = Number(token.votes_24h || 0);

  const { error: updateError } = await supabase
    .from('tokens')
    .update({ votes_all_time: currentAllTime + 1, votes_24h: current24h + 1 })
    .eq('address', address);
  if (updateError) throw updateError;

  const { error: logError } = await supabase.from('vote_logs').insert({
    token_address: address,
    voter_key: `tg:${telegramId}`,
    source: 'telegram',
  });
  if (logError) throw logError;
  return { ...token, votes_all_time: currentAllTime + 1, votes_24h: current24h + 1 };
}

export async function getMyListings(telegramId) {
  const { data, error } = await supabase
    .from('tokens')
    .select('name,symbol,address,status,listing_tier,promoted,listed_at,payment_reference')
    .eq('submitted_by_telegram_id', String(telegramId))
    .order('listed_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function recordPaymentIntent(payload) {
  const { error } = await supabase.from('payments').insert(payload);
  if (error) throw error;
}

export async function approveToken(address) {
  const { error } = await supabase
    .from('tokens')
    .update({ status: 'approved' })
    .eq('address', address);
  if (error) throw error;
}

export async function rejectToken(address, reason = null) {
  const { error } = await supabase
    .from('tokens')
    .update({ status: 'rejected', admin_notes: reason })
    .eq('address', address);
  if (error) throw error;
}

export async function boostVotes(address, amount, reason = 'manual boost') {
  const token = await getTokenByAddress(address);
  if (!token) throw new Error('Token not found');
  const nextBoost = Number(token.admin_boost_votes || 0) + Number(amount || 0);
  const { error: updateError } = await supabase
    .from('tokens')
    .update({ admin_boost_votes: nextBoost })
    .eq('address', address);
  if (updateError) throw updateError;

  const { error: logError } = await supabase.from('admin_actions').insert({
    token_address: address,
    action: 'boost_votes',
    value: Number(amount || 0),
    reason,
  });
  if (logError) throw logError;
  return nextBoost;
}

export async function searchTokens(term) {
  const like = `%${term}%`;
  const { data, error } = await supabase
    .from('tokens')
    .select('name,symbol,address,status,votes_all_time,admin_boost_votes')
    .or(`name.ilike.${like},symbol.ilike.${like},address.ilike.${like}`)
    .order('listed_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data || [];
}
