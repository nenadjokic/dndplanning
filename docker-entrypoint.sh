#!/bin/sh
set -e

echo "🔧 Quest Planner - Docker Entrypoint"
echo ""

# Check if migration script exists and run it
if [ -f "/app/db/migrate-v2-complete.js" ]; then
  echo "📦 Running database migrations..."
  node /app/db/migrate-v2-complete.js
  echo ""
else
  echo "⚠️  No migration script found, skipping..."
  echo ""
fi

echo "🚀 Starting Quest Planner..."
echo ""

# Start the application
exec node server.js
