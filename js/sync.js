// js/sync.js
window.Sync = (() => {
  let channel = null;

  function subscribeToPartner(partnerName, onNewSession) {
    channel = DB.client
      .channel('partner-sessions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sessions',
          filter: `user_name=eq.${partnerName}`,
        },
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

  return { subscribeToPartner, unsubscribe };
})();
