// js/auth.js — username/password auth on top of Supabase Auth.
// There is no real email: a username is mapped to a synthetic <slug>@muscleup.local
// address. Email uniqueness in auth.users gives us free username (slug) uniqueness;
// a separate UNIQUE(username) on profiles guards the display name.
window.Auth = (() => {
  const client = DB.client;
  const EMAIL_DOMAIN = 'muscleup.local';

  // username -> url/email-safe slug: lowercase, strip diacritics, non-alnum -> '_'
  function slug(username) {
    return (username || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')   // drop combining accents
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function emailFor(username) {
    return `${slug(username)}@${EMAIL_DOMAIN}`;
  }

  // Returns an error string if invalid, otherwise null.
  function validate(username, password) {
    const s = slug(username);
    if (s.length < 2 || s.length > 30) {
      return 'Name muss 2 bis 30 Zeichen (Buchstaben/Zahlen) enthalten.';
    }
    if (!password || password.length < 6) {
      return 'Passwort muss mindestens 6 Zeichen lang sein.';
    }
    return null;
  }

  // -> { error: string | null }
  async function signUp(username, password) {
    const invalid = validate(username, password);
    if (invalid) return { error: invalid };

    const { data, error } = await client.auth.signUp({
      email: emailFor(username),
      password,
      options: { data: { username: username.trim() } },
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || error.status === 422) {
        return { error: 'Dieser Name ist bereits vergeben.' };
      }
      return { error: error.message || 'Registrierung fehlgeschlagen.' };
    }
    if (!data.session) {
      // Happens if "Confirm email" is still enabled in the Supabase dashboard.
      return { error: 'Konto angelegt, aber keine Sitzung. Bitte E-Mail-Bestätigung in Supabase deaktivieren.' };
    }

    // Create the profile row (RLS: WITH CHECK auth.uid() = user_id passes now).
    const { error: profileErr } = await client
      .from('profiles')
      .insert({ user_id: data.user.id, username: username.trim(), current_phase: 1 });

    if (profileErr) {
      if (profileErr.code === '23505') {
        return { error: 'Dieser Name ist bereits vergeben.' };
      }
      return { error: profileErr.message || 'Profil konnte nicht erstellt werden.' };
    }
    return { error: null };
  }

  // -> { error: string | null }
  async function signIn(username, password) {
    if (!slug(username) || !password) {
      return { error: 'Bitte Name und Passwort eingeben.' };
    }
    const { error } = await client.auth.signInWithPassword({
      email: emailFor(username),
      password,
    });
    if (error) {
      return { error: 'Name oder Passwort ist falsch.' };
    }
    return { error: null };
  }

  async function signOut() {
    return client.auth.signOut();
  }

  // Reads the persisted session from localStorage (no network). -> session | null
  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  // cb(event, session) for INITIAL_SESSION / SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED
  function onChange(cb) {
    return client.auth.onAuthStateChange(cb);
  }

  return { slug, emailFor, signUp, signIn, signOut, getSession, onChange };
})();
