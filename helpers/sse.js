// Server-Sent Events manager for real-time updates
const clients = new Set();
const MAX_SSE_CLIENTS = 500;

function addClient(res) {
  // Prevent server overload by limiting SSE connections
  if (clients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: 'Server at capacity. Please try again later.' });
    return;
  }

  clients.add(res);

  // Send initial keepalive
  res.write(':keepalive\n\n');

  // Send keepalive every 30 seconds to prevent timeout
  const keepalive = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (e) {
      clearInterval(keepalive);
      clients.delete(res);
    }
  }, 30000);

  res.on('close', () => {
    clearInterval(keepalive);
    clients.delete(res);
  });

  res.on('error', () => {
    clearInterval(keepalive);
    clients.delete(res);
  });
}

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const deadClients = [];

  for (const client of clients) {
    try {
      client.write(message);
    } catch (e) {
      deadClients.push(client);
    }
  }

  // Clean up dead clients
  deadClients.forEach(c => clients.delete(c));
}

module.exports = { addClient, broadcast };
