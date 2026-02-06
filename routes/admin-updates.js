const express = require('express');
const router = express.Router();
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Admin update routes with SSE progress streaming
 */

// SSE endpoint for D&D data import with progress
router.get('/dnd-data/import-stream', requireLogin, requireAdmin, (req, res) => {
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial message
  res.write(`data: ${JSON.stringify({ type: 'start', message: '🚀 Starting D&D data import...' })}\n\n`);

  // Run the import script
  const scriptPath = path.join(__dirname, '../scripts/import-5etools-data.js');
  const importProcess = spawn('node', [scriptPath]);

  let buffer = '';

  importProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: ${JSON.stringify({ type: 'progress', message: line })}\n\n`);
      }
    });
  });

  importProcess.stderr.on('data', (data) => {
    const message = data.toString();
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
  });

  importProcess.on('close', (code) => {
    if (code === 0) {
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        message: '✅ D&D data import completed successfully!'
      })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: `❌ Import failed with code ${code}`
      })}\n\n`);
    }
    res.end();
  });

  req.on('close', () => {
    importProcess.kill();
  });
});

// SSE endpoint for app update with progress
router.get('/app-update/stream', requireLogin, requireAdmin, (req, res) => {
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  const sendMessage = (type, message) => {
    try {
      res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
    } catch (err) {
      console.error('[SSE] Failed to send message:', err.message);
    }
  };

  // Keepalive ping every 10 seconds
  const keepAlive = setInterval(() => {
    sendMessage('ping', '');
  }, 10000);

  // Cleanup function
  const cleanup = () => {
    clearInterval(keepAlive);
  };

  // Cleanup on client disconnect
  req.on('close', () => {
    cleanup();
    console.log('[SSE] Client disconnected');
  });

  // Cleanup on response finish
  res.on('finish', cleanup);

  sendMessage('start', '🚀 Starting application update...');

  // Step 1: Git pull
  sendMessage('progress', '📥 Pulling latest changes from GitHub...');
  const gitPull = spawn('git', ['pull', 'origin', 'main'], {
    cwd: process.cwd(),
    timeout: 30000 // 30 second timeout
  });

  let gitOutput = '';

  // Timeout fallback (in case spawn timeout doesn't work)
  const gitTimeout = setTimeout(() => {
    gitPull.kill();
    sendMessage('error', '❌ Git pull timed out after 30 seconds');
    res.end();
  }, 30000);

  gitPull.stdout.on('data', (data) => {
    const message = data.toString().trim();
    if (message) {
      gitOutput += message + '\n';
      sendMessage('progress', `  ${message}`);
    }
  });

  gitPull.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message) sendMessage('progress', `  ${message}`);
  });

  gitPull.on('error', (err) => {
    clearTimeout(gitTimeout);
    sendMessage('error', `❌ Git command failed: ${err.message}`);
    res.end();
  });

  gitPull.on('close', (code) => {
    clearTimeout(gitTimeout);
    if (code !== 0) {
      sendMessage('error', `❌ Git pull failed with code ${code}`);
      res.end();
      return;
    }

    // Check if already up to date
    if (gitOutput.includes('Already up to date')) {
      sendMessage('complete', '✅ Already up to date! No changes to pull.');
      res.end();
      return;
    }

    sendMessage('progress', '✅ Git pull complete');

    // Step 2: Check if package.json changed
    const gitDiff = spawn('git', ['diff', 'HEAD@{1}', 'HEAD', '--name-only']);
    let packageChanged = false;

    gitDiff.stdout.on('data', (data) => {
      if (data.toString().includes('package.json')) {
        packageChanged = true;
      }
    });

    gitDiff.on('close', () => {
      if (packageChanged) {
        sendMessage('progress', '📦 package.json changed, installing dependencies...');

        const npmInstall = spawn('npm', ['install']);

        npmInstall.stdout.on('data', (data) => {
          const message = data.toString().trim();
          if (message) sendMessage('progress', `  ${message}`);
        });

        npmInstall.stderr.on('data', (data) => {
          const message = data.toString().trim();
          if (message) sendMessage('progress', `  ${message}`);
        });

        npmInstall.on('close', (code) => {
          if (code !== 0) {
            sendMessage('error', `❌ npm install failed with code ${code}`);
            res.end();
            return;
          }

          sendMessage('progress', '✅ Dependencies installed');
          finishUpdate();
        });
      } else {
        finishUpdate();
      }
    });

    function finishUpdate() {
      sendMessage('progress', '🔄 Restarting server...');
      sendMessage('complete', '✅ Update complete! Server will restart in 2 seconds.');

      setTimeout(() => {
        res.end();
        // Restart the server
        process.exit(0); // PM2 or systemd will restart it
      }, 2000);
    }
  });

  req.on('close', () => {
    gitPull.kill();
  });
});

module.exports = router;
