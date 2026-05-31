// js/sync.js
window.Sync = (() => {
  let channel = null;

  // Subscribe to ALL new sessions (any user). RLS lets every logged-in user read
  // every row, so each INSERT is delivered — the live leaderboard recomputes on it.
  // Must be called only AFTER a confirmed auth session exists (the SDK pushes the
  // JWT to the realtime socket asynchronously); subscribing too early attaches with
  // the anon token and RLS silently delivers nothing.
  function subscribeToSessions(onNewSession) {
    unsubscribe();
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

  function unsubscribe() {
    if (channel) {
      DB.client.removeChannel(channel);
      channel = null;
    }
  }

  return { subscribeToSessions, unsubscribe };
})();
