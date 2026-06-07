// js/sync.js
window.Sync = (() => {
  let channel = null;     // sessions (muscle-up leaderboard)
  let hsChannel = null;   // handstand_sessions (handstand standings)

  // Subscribe to ALL new sessions (any user). RLS lets every logged-in user read
  // every row, so each INSERT is delivered — the live leaderboard recomputes on it.
  // Must be called only AFTER a confirmed auth session exists (the SDK pushes the
  // JWT to the realtime socket asynchronously); subscribing too early attaches with
  // the anon token and RLS silently delivers nothing.
  function subscribeToSessions(onNewSession) {
    if (channel) { DB.client.removeChannel(channel); channel = null; }
    channel = DB.client
      .channel('sessions-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => onNewSession(payload.new)
      )
      .subscribe();
    return channel;
  }

  // Same contract as subscribeToSessions, for the handstand standings. Each
  // subscribe clears only its OWN channel so the two can coexist; the global
  // unsubscribe() below tears both down on logout / re-subscribe.
  function subscribeToHandstand(onNewSession) {
    if (hsChannel) { DB.client.removeChannel(hsChannel); hsChannel = null; }
    hsChannel = DB.client
      .channel('handstand-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'handstand_sessions' },
        (payload) => onNewSession(payload.new)
      )
      .subscribe();
    return hsChannel;
  }

  function unsubscribe() {
    if (channel) { DB.client.removeChannel(channel); channel = null; }
    if (hsChannel) { DB.client.removeChannel(hsChannel); hsChannel = null; }
  }

  return { subscribeToSessions, subscribeToHandstand, unsubscribe };
})();
